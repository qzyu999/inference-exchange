# Inference Exchange vs. Apple Private Cloud Compute

**Status:** Draft — Public Alpha reference

## Purpose

Apple's [Private Cloud Compute](https://security.apple.com/documentation/private-cloud-compute) (PCC) defines five core requirements for confidential cloud inference. This document uses those five principles as a structured evaluation framework for Inference Exchange (IE).

IE is **not** PCC and does not claim to be. PCC runs on Apple-designed server hardware in Apple-controlled data centers with custom silicon and a purpose-built OS. IE runs on commodity Apple Silicon machines operated by independent third parties. The threat models are fundamentally different: PCC protects users from Apple itself; IE protects consumers from independent provider operators and a coordinator operator.

The value of this comparison is precision: Apple's framework gives us a concrete vocabulary for what we do provide, what we partially provide, and what we honestly cannot provide without hardware we don't control.

## Summary matrix

| PCC Principle | PCC Implementation | IE Alpha Status | Gap |
|---|---|---|---|
| Stateless computation | Ephemeral VMs destroyed after use | Long-lived process, no enforced data deletion | Large |
| Enforceable guarantees | Custom silicon + sealed OS + hardware attestation | Hardened Runtime + SIP + PT_DENY_ATTACH + code signing | Moderate |
| No privileged runtime access | Operators cannot SSH, debug, or inspect workloads | Operators cannot read process memory (L2); can see metadata | Moderate |
| Non-targetability | Apple controls routing inside attested infrastructure | Consumer verifies provider via App Attest before encrypting | Large |
| Verifiable transparency | Published source + hardware attestation proves running code | Open source + binary hash attestation, no reproducible builds | Large |

## 1. Stateless computation on personal user data

### What PCC does

Each PCC request runs in an ephemeral virtual machine. The VM is created for the request, processes it, and is destroyed. No user data persists in memory, disk, or any durable store. The hardware enforces that the VM's memory is encrypted and inaccessible after destruction.

### What IE does today

The provider runs a long-lived inference server process that serves multiple requests sequentially. After a request completes:

- The inference server returns tokens and moves on to the next request
- KV cache may retain fragments from previous requests until overwritten
- The agent process holds no request state after streaming completes
- The coordinator stores billing metadata (token counts, cost) but not prompt content

### Gap

IE does not enforce statelessness. Specifically:

- **KV cache**: llama.cpp's KV cache is not zeroed between requests. A subsequent request could theoretically observe residual data in allocated-but-unwritten cache slots. In practice this is unlikely to leak meaningful plaintext (the cache is overwritten by the next context), but it is not provably clean.
- **Process memory**: the long-lived process may retain heap fragments containing previous request data until that memory is reused or the process exits.
- **Logs**: addressed by #7 (audit provider logging for plaintext leakage), but not yet enforced or tested.
- **Temp/crash artifacts**: addressed by the hardening module (core dumps disabled), but not comprehensively tested (#3, #4).

### Path to closing

| Timeframe | Action |
|---|---|
| Alpha | Verify KV cache doesn't leak across requests (canary test). Verify logs contain no plaintext (#7). Core dump disabled (#3). |
| Beta | Zero KV cache between sessions. Explicit memory wipe of decrypted request data after response completes. |
| Future | Per-session process isolation (new inference server process per session, or Virtualization.framework VM per session). This is the only path to PCC-equivalent statelessness. |

Related issues: #3, #7, #8

## 2. Enforceable guarantees

### What PCC does

PCC uses Apple-designed server chips with hardware-level memory encryption, a sealed/immutable OS image, and Secure Enclave attestation. The guarantees are enforced by silicon — software running on the machine cannot bypass them without a hardware exploit.

### What IE does today

IE's L2 profile uses the macOS security stack on Apple Silicon:

- **Hardened Runtime**: Apple documents this as preventing code injection, dynamic library hijacking, and process memory space tampering when enabled with the appropriate configuration.
- **SIP (System Integrity Protection)**: protects system binaries and kernel extensions from modification.
- **PT_DENY_ATTACH**: permanently blocks ptrace-based debugger attachment for the process lifetime.
- **Code signing + Developer ID + notarization**: establishes the binary identity and prevents unsigned/modified code from running under Gatekeeper.
- **Core dump disabled**: prevents plaintext from escaping through crash artifacts.
- **Entitlements**: `com.apple.security.get-task-allow` is explicitly absent, preventing debug access.

### Gap

The enforcement is real but narrower than PCC:

- **GPU/unified memory**: PT_DENY_ATTACH and Hardened Runtime protect CPU process memory. Whether Metal GPU buffers in Apple Silicon unified memory are equally protected from an operator with admin access is not documented by Apple and not yet tested by IE. This is flagged in the L2 threat model (section 10) as requiring an Apple Silicon/Metal-specific attack test.
- **No custom silicon**: PCC has hardware-level memory encryption that makes DRAM unreadable without the CPU's keys. IE relies on OS-level process isolation — a kernel exploit or physical memory attack bypasses it.
- **No sealed OS**: PCC's OS image is immutable and attested. IE runs on a standard macOS installation that the operator controls and can update.

### Honest framing

IE's L2 guarantee should be stated as:

> The provider operator cannot recover inference plaintext using supported user-space or OS-level inspection mechanisms. Bypassing L2 requires a kernel-level exploit, physical attack, or compromise below the macOS security boundary.

This is meaningfully weaker than PCC's "requires compromising Apple-designed silicon" but meaningfully stronger than "we promise not to look."

Related issues: #3, #4, #5, #6, #8

## 3. No privileged runtime access

### What PCC does

PCC operators cannot SSH into PCC nodes, cannot attach debuggers, cannot inspect running workloads, cannot access logs containing user data, and cannot see which users' requests are being processed. The hardware and OS enforce this — it's not a policy decision.

### What IE does today

**Coordinator**: currently sees plaintext requests (#21). Once #28/#29 land, the coordinator becomes a blind relay — it routes by session/admission metadata and relays encrypted envelopes. It can observe: timing, ciphertext length, which provider handles which session, billing metadata. It cannot observe: prompt content, response content.

**Provider (L2)**: the operator cannot read inference process memory (Hardened Runtime + PT_DENY_ATTACH), cannot attach debuggers, cannot inject code. The operator *can*: see that processes are running (`ps`), observe CPU/RAM/GPU utilization, see network connection metadata, kill processes (denial of service).

### Gap

- **Coordinator plaintext**: the critical gap. On main today, the coordinator sees everything. This is the #1 priority to fix (#21, #28, #29).
- **Provider metadata**: the operator sees more metadata than PCC allows. Process names, resource usage, connection timing are all visible. This is acceptable for IE's threat model (availability/metadata, not confidentiality) but should be documented as a known difference.
- **Provider admin access**: the operator has root on the machine. PCC operators don't. The L2 claim is that root access doesn't help because the OS prevents reading protected process memory, not that root access doesn't exist.

Related issues: #21, #28, #29

## 4. Non-targetability

### What PCC does

Because Apple controls both the routing layer and the compute infrastructure, and both run on attested hardware, an attacker (including an Apple insider) cannot selectively route a target user's requests to a compromised node. The routing layer runs in the same attested environment as the compute — there's no seam to exploit.

### What IE does today

IE's architecture has a structural non-targetability challenge that PCC doesn't face:

```
Consumer ──encrypt to provider key──▶ Coordinator ──relay──▶ Provider
                                          │
                          decides which provider
                          gets which request
```

The coordinator decides routing. A malicious coordinator operator could:

1. Register a provider they control with a legitimate-looking key
2. Route a target consumer's requests to that provider
3. The consumer encrypted to that provider's key (because the coordinator presented it)
4. The malicious provider decrypts and exfiltrates

### Defense: consumer-side provider verification

The planned defense (#19, #22, #25, #27) is for the consumer to verify the provider's identity independently of the coordinator:

1. Provider registers with App Attest evidence, binding its identity to Apple hardware
2. Coordinator stores the admission record but cannot forge it (Apple's CA is the root of trust)
3. Consumer requests provider offers and verifies the App Attest chain: provider key → App Attest certificate → Apple root CA
4. Consumer encrypts only to keys that pass this verification
5. A fake provider inserted by a malicious coordinator would fail the App Attest verification

### Remaining gap

Even with App Attest:

- The coordinator controls *which* legitimate provider gets a specific request. If multiple genuine providers exist, the coordinator can route a target user's requests to a specific one, then compromise that specific provider machine. This is a weaker attack (requires compromising a real provider, not just faking one) but still possible.
- App Attest proves the *app* is genuine on genuine hardware. It does not prove the app hasn't been modified after attestation, or that the operator hasn't found a way to extract data from the running process. That's what L2 hardening addresses separately.
- The consumer must trust the coordinator to present *all* eligible providers, not a curated subset. If the coordinator hides all providers except the one it controls, the consumer has no alternatives. This is a marketplace transparency problem, not a crypto problem.

### Honest framing

> IE provides non-targetability against a coordinator that cannot forge App Attest certificates (requires compromising Apple's attestation CA) and cannot bypass L2 hardening on the selected provider (requires a kernel exploit). A coordinator operator who controls both the routing layer and a legitimate provider machine could target users by routing, but cannot decrypt without also defeating L2 on the provider.

Related issues: #19, #22, #25, #27

## 5. Verifiable transparency

### What PCC does

Apple publishes the source code of PCC software. Independent security researchers can inspect it. When a request is processed, the hardware attestation proves that the exact published code (built by Apple's auditable build pipeline) is what's running. The client device verifies this attestation before sending any data.

The verification chain: published source → reproducible build → binary hash → hardware attestation certificate → client verifies → sends data.

### What IE does today

- **Source is open**: the IE repository is public. Anyone can inspect the coordinator, agent, inference server, and hardening code.
- **Binary hash attestation**: the agent and server binary SHA-256 hashes are reported during attestation. The coordinator records them.
- **GGUF model hash**: the model file hash is verified against HuggingFace's published hashes.
- **Code signing**: the production binary is signed with Developer ID and notarized by Apple.

### Gap

- **No reproducible builds**: there's no way for a consumer to go from the public source to a binary hash and verify that the provider is running that exact build. PyInstaller builds are not deterministic. Without reproducible builds, the binary hash is just a fingerprint — it tells you the binary hasn't changed, but not that it was built from the published source.
- **App Attest is not code attestation**: App Attest proves the app is genuine and running on real hardware. It does not prove *what the app does*. A signed, notarized, App Attest-verified binary could still contain malicious code if the developer (you) shipped it. PCC solves this with published source + independent audit + hardware proving the audited code is running. IE would need a trusted build pipeline (reproducible, auditable) to close this gap.
- **No independent audit**: PCC invites security researchers to inspect its code. IE is open source (good) but hasn't had an independent security audit.

### Path to closing

| Timeframe | Action |
|---|---|
| Alpha | Document the verification chain honestly: source is public, binary hash is attested, but the build-to-binary link is not independently verifiable. |
| Beta | Investigate reproducible builds (Nix, deterministic PyInstaller, or compile from source on the provider machine). |
| Future | Formal third-party security audit. Reproducible build pipeline with published build hashes that consumers can verify against attestation. |

Related issues: #3, #14, #19

## Architecture comparison

```
                    PCC                              IE (Alpha target)
               ┌──────────┐                     ┌──────────┐
               │  Client   │                     │ Consumer │
               │  (iPhone) │                     │  (SDK)   │
               └─────┬─────┘                     └─────┬─────┘
                     │                                  │
            HW attestation                    App Attest verification
            verification                     (Apple CA root of trust)
                     │                                  │
               ┌─────▼─────┐                     ┌─────▼──────┐
               │  Apple     │                     │ Coordinator │
               │  Routing   │                     │ (blind      │
               │  (attested)│                     │  relay)     │
               └─────┬─────┘                     └─────┬──────┘
                     │                                  │
               ┌─────▼─────┐                     ┌─────▼──────┐
               │  PCC Node  │                     │  Provider   │
               │            │                     │             │
               │ Custom     │                     │ Apple Si    │
               │ silicon    │                     │ + macOS     │
               │ Sealed OS  │                     │ + Hardened  │
               │ HW encrypt │                     │   Runtime   │
               │ Ephemeral  │                     │ + SIP       │
               │ VM         │                     │ + PT_DENY   │
               │            │                     │ + codesign  │
               └────────────┘                     └─────────────┘

  Trust boundary:          │          Trust boundary:
  Apple silicon            │          macOS kernel
  (physical attack         │          (kernel exploit
   to bypass)              │           to bypass)
```

## What IE can honestly claim

For the Public Alpha, the honest positioning relative to PCC's framework:

1. **Stateless computation**: not enforced. Provider processes are long-lived. Data is not guaranteed to be destroyed after a session. Alpha mitigation: verify no persistence through logs/artifacts.

2. **Enforceable guarantees**: partially enforced. macOS Hardened Runtime, SIP, and PT_DENY_ATTACH create a real OS-level barrier. The bypass requires a kernel exploit, not just admin access. GPU/unified memory protection is untested.

3. **No privileged runtime access**: enforced on the provider side (L2). Not yet enforced on the coordinator side (plaintext exposure until #21/#28/#29 land).

4. **Non-targetability**: partially addressed by App Attest provider verification. The coordinator still controls routing and could direct a target to a specific (legitimate) provider. Full non-targetability would require the consumer to independently select providers.

5. **Verifiable transparency**: source is open, binary hashes are attested, but the build-to-binary link is not independently verifiable. No formal security audit.

The overall security boundary is:

> IE L2 protects against a user-space provider operator and (once #21 lands) a coordinator operator who cannot forge Apple App Attest certificates. Bypassing IE requires a macOS kernel exploit, Apple attestation CA compromise, or physical attack. This is meaningfully weaker than PCC (which requires compromising Apple-designed silicon) but meaningfully stronger than trusting the operator's promise.

## References

- [Apple PCC Security Documentation](https://security.apple.com/documentation/private-cloud-compute)
- [Apple Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- [IE L2 Threat Model](threat-model.md)
- [IE Architecture](../architecture.md)
