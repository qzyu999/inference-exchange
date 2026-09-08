# Inference Exchange L2 Threat Model

**Status:** Draft for Public Alpha

## 1. Purpose

This document defines the security claim made by an **L2 (Hardened)** provider in Inference Exchange. It is intentionally narrower than a general claim that the provider is "secure" or "confidential."

The goal is a falsifiable statement that can be tested against the actual provider implementation.

For the Public Alpha, L2 is not a new cryptographic primitive. It is a **platform-specific security profile built from documented Apple macOS security mechanisms**, together with Inference Exchange configuration and attack testing. The project claims only the properties that the resulting composition can demonstrate.

## 2. Alpha scope

The initial Public Alpha target is **Apple Silicon + macOS 14+ + the hardened provider runtime**.

The L2 model is platform-specific. Other platforms must define and independently validate their own L2 backend before advertising the same guarantees.

The reference Apple implementation is based primarily on:

- **Hardened Runtime**, which Apple documents as preventing classes of attacks including code injection, dynamic-library hijacking, and process-memory-space tampering when the corresponding protections are enabled.
- **System Integrity Protection (SIP)** and the macOS process-security model.
- **Code signing / Developer ID / notarization** for the production distribution path.
- A provider configuration that intentionally avoids debugger-oriented entitlements such as `com.apple.security.get-task-allow`.
- Explicit core-dump and artifact controls implemented by the provider.
- `PT_DENY_ATTACH` as an additional debugger-resistance mechanism where supported by the provider implementation.

Apple's documentation establishes what these platform mechanisms are designed to enforce. It does **not** establish that their particular composition with our provider, llama.cpp, Metal, and unified memory automatically provides the full L2 claim. That is why the provider must still pass workload-specific attack tests.

### Apple platform references

The primary implementation references are:

- Apple Developer Documentation — [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- Apple Developer Documentation — [Configuring the hardened runtime](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime)
- Apple Developer Documentation — [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- Apple Developer — [Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- Apple Developer Documentation — [Security](https://developer.apple.com/documentation/security)
- Apple Developer Documentation — [Virtualization](https://developer.apple.com/documentation/virtualization)

Virtualization.framework is documented as a separate Apple Silicon isolation option. It is **not required by the current native-process L2 profile** and should not be implied by the current implementation. A VM-backed provider may become a separate L2 backend if its isolation boundary and attack model are independently validated.

## 3. Security claim

### 3.1 L2 confidentiality claim

> While an approved L2 provider runtime is executing normally on a supported Apple Silicon/macOS system with the required platform security state enabled, a local provider operator with ordinary user/administrator control of the host cannot recover inference plaintext using supported user-space or OS-level inspection mechanisms covered by the Public Alpha attack suite.

Here **inference plaintext** means consumer prompt/input data, generated output data, and provider-held inference state that contains or directly reconstructs that data.

The intended bypass boundary is a compromise below the provider process, such as a successful kernel-level exploit, hypervisor/firmware compromise, or physical attack.

This is a **verified-profile claim**, not a claim that Apple provides a single "confidential process" API. The profile combines Apple platform controls with provider-specific configuration and testing.

### 3.2 Critical qualification: L2 is not remote attestation

L2 is an **execution-environment property**, not by itself proof that a remote provider is honest or is running the expected binary.

A malicious provider operator who is able to substitute a different provider implementation before execution may simply create a program that intentionally copies plaintext once the request is decrypted. Process hardening cannot prevent a program from exposing its own plaintext.

Therefore the alpha claim is explicitly conditional on the provider runtime being the approved implementation/configuration. The current system does **not** treat local code signing, Developer ID, notarization, or a provider self-report as equivalent to hardware-backed remote attestation.

Apple code signing and notarization are useful deployment and code-identity controls, but they do not by themselves let a remote consumer cryptographically prove the exact runtime state of an arbitrary provider host. Remote verification of provider identity/code state is a separate capability and must not be implied by the L2 label until implemented and validated.

## 4. Protected assets

L2 protects the following while they are handled by the approved provider runtime:

1. Consumer prompts and input tokens.
2. Generated outputs and output tokens.
3. Decrypted request contents.
4. Conversation/session state containing consumer data.
5. KV cache and other reusable inference state containing consumer data.
6. Intermediate CPU/GPU/unified-memory state that contains or directly reconstructs consumer data, **to the extent the relevant memory is actually covered by the tested L2 isolation boundary**.
7. Ephemeral cryptographic session material held by the provider process, except material intentionally exposed by protocol design.

## 5. Non-assets / metadata that L2 does not hide

L2 does not by itself hide:

- Provider uptime or availability.
- CPU/RAM/GPU utilization.
- Approximate request timing.
- Network endpoints and traffic volume where visible to the host.
- Model identity or other information intentionally advertised by the provider.
- The fact that an inference workload is executing.
- Billing/accounting metadata intentionally handled by the coordinator.

Traffic confidentiality between consumer and coordinator/provider is provided by the OCIP confidential transport layer and is a separate property from host-process hardening.

## 6. Threat actor

### 6.1 In-scope attacker: local provider operator

Assume the operator has ordinary administrative/user control of the provider machine and is actively attempting to recover consumer plaintext.

The operator may:

- Inspect ordinary files readable by the operator.
- Inspect process lists and command-line arguments.
- Observe CPU, RAM, GPU, disk, and network metadata.
- Read application/runtime logs available to the operator.
- Start, stop, and restart the provider.
- Kill the provider process.
- Attempt debugger attachment.
- Attempt supported OS process-memory inspection.
- Attempt to obtain core dumps or crash artifacts.
- Attempt dynamic-library injection.
- Attempt user-space process modification.
- Change ordinary user-space configuration.
- Attempt to observe data through temporary files or ordinary telemetry paths.

The operator is **not trusted merely because they own or operate the machine**.

### 6.2 Out-of-scope attacker: compromised platform

The following are outside the L2 guarantee:

- Successful kernel exploit or kernel-level compromise.
- Firmware compromise.
- Hypervisor compromise or successful VM escape where a VM implementation is used.
- Platform security mechanisms deliberately disabled outside the supported provider configuration.
- Physical probing, invasive hardware attacks, or forensic attacks outside the software threat model.
- Malicious hardware or a compromised hardware root of trust.
- Supply-chain compromise of the build/signing infrastructure.
- Side-channel attacks unless explicitly added to scope and tested.

L2 should therefore **not** be described as protection against a nation-state/0-day-class attacker or as hardware confidential computing.

## 7. Malicious provider binary limitation

This is one of the most important boundaries in the model.

If the operator can cause an intentionally modified provider program to execute, and that program is allowed to decrypt requests, then process hardening cannot make that program confidential against its own behavior.

Therefore:

**L2 does not currently provide cryptographic proof that a remote provider is executing the approved code.**

Apple's Developer ID signing and notarization are valuable supply/distribution controls: Apple describes Developer ID as enabling Gatekeeper to verify a developer identity, and notarization as automated checking of Developer ID-signed software. Those controls should be part of our deployment procedure, but they must not be presented as equivalent to remote runtime attestation. 

The current alpha architecture should treat:

- code identity,
- binary signing,
- runtime integrity,
- provider attestation,

as separate properties that must eventually be verified rather than inferred from the L2 label.

## 8. Security boundary

```text
                    INFERENCE EXCHANGE

 Consumer
    |
    | encrypted request
    v
 Coordinator
    |
    | encrypted relay
    v
 +-----------------------------+
 | Approved L2 Provider Runtime |
 |                             |
 |  decrypt -> tokenize ->     |
 |  infer -> generate ->       |
 |  encrypt response           |
 |                             |
 |  plaintext exists here      |
 +-----------------------------+
    ^
    |
    | OS/process security boundary
    |
 Provider Host / Operator

Operator may observe metadata and control availability,
but must not have a supported path to inspect the runtime's
protected plaintext state.
```

### Boundary A — Consumer → Coordinator

The coordinator must not require or receive consumer inference plaintext.

### Boundary B — Coordinator → Provider

The request remains encrypted until it reaches the provider runtime capable of decrypting it.

### Boundary C — Inside provider runtime

Plaintext necessarily exists during tokenization and inference. The security claim begins by limiting access to that plaintext to the approved provider process/runtime.

### Boundary D — Provider operator → Provider runtime

The operator may control the host and availability but must not have a supported OS/user-space mechanism to read protected process state.

### Boundary E — Runtime → external artifacts

Prompts, outputs, keys, and sensitive inference state must not escape through logs, crash dumps, temporary files, telemetry, or debugging interfaces.

## 9. Apple Silicon L2 profile

The Public Alpha should define the native-process implementation as an explicit **Apple Silicon L2 profile** rather than as a collection of loosely related hardening tricks.

### Required platform controls

| Control | Alpha requirement | Why it matters |
|---|---|---|
| Apple Silicon | Required | Fixes the supported platform and memory/accelerator architecture for this profile. |
| macOS security state | Required | The profile assumes Apple's platform security mechanisms remain enabled. |
| SIP | Required | Part of the host/process security boundary. |
| Hardened Runtime | Required | Apple documents protections against classes of code injection, library hijacking, and process-memory-space tampering. |
| `com.apple.security.get-task-allow` | Must be absent/false | Apple requires it not to be enabled for normal notarized distribution; it is specifically associated with debugger access. |
| Unnecessary Hardened Runtime exceptions | Must be absent | Exceptions weaken the default protections and must be justified individually. |
| Developer ID signing | Required for production distribution | Establishes the signed publisher identity used by Gatekeeper. |
| Notarization | Required for production distribution | Apple checks the submitted Developer ID-signed software for malicious content and signing issues. |
| Secure timestamp | Required for production distribution | Part of Apple's documented notarization preparation. |
| Core-dump controls | Required | Prevents plaintext from escaping through generated crash/core artifacts. |
| Logging/artifact policy | Required | Prevents application-controlled leakage outside the process boundary. |
| Provider self-test | Required | Detects unsupported or misconfigured platform state before advertising L2. |

The exact entitlements should remain minimal. The current provider entitlements explicitly avoid `com.apple.security.get-task-allow`; that is good, but the final L2 acceptance test should verify the **signed artifact actually installed on the host**, rather than trusting the source entitlement file.

### Additional controls under evaluation

**App Sandbox:** potentially useful for limiting filesystem/resource access, but it is not itself the L2 confidentiality primitive. It should only be required if the actual llama.cpp/Metal deployment works correctly under the resulting sandbox profile.

**Virtualization.framework:** Apple provides a first-party Apple Silicon VM framework. A VM-backed provider could eventually provide a separate isolation implementation, but the current native-process profile should not claim VM-level isolation.

**Secure Enclave / hardware-backed keys:** useful for key protection, but not a substitute for proving the confidentiality of the inference process or accelerator memory.

## 10. Required L2 properties

A conforming Apple Silicon/macOS L2 implementation must establish evidence for all of the following:

| Property | Required result | Verification |
|---|---|---|
| Platform state | Required Apple security state is enabled | Startup self-test + independent verification |
| Signed runtime | Installed provider is signed as required by deployment policy | `codesign`/signature verification + recorded identity/hash |
| Hardened Runtime | Actual executable has Hardened Runtime enabled | `codesign`/runtime verification |
| Debugger resistance | Supported debugger attachment cannot inspect protected state | Automated attack test |
| Process-memory resistance | Supported external memory inspection cannot recover plaintext | Automated/repeatable attack test |
| Injection resistance | Supported library/process injection cannot cause protected-state disclosure | Automated/repeatable attack test |
| Core-dump resistance | Provider plaintext is not recoverable from generated core dumps | Automated test |
| Logging confidentiality | Plaintext does not appear in provider logs | Static review + regression test |
| Artifact confidentiality | Plaintext does not appear in temp/crash artifacts | Regression/security test |
| Coordinator confidentiality | Coordinator does not receive inference plaintext | Protocol/cryptographic test |
| GPU/unified-memory boundary | If inference uses GPU/unified memory, external supported mechanisms cannot recover protected inference data | Apple Silicon/Metal-specific attack test |

A property is **not considered proven merely because the implementation contains a corresponding API call, entitlement, or configuration flag**.

## 11. Apple platform controls vs. Inference Exchange evidence

This distinction is important:

| Layer | What Apple documents/provides | What Inference Exchange must prove |
|---|---|---|
| Hardened Runtime | System-enforced runtime restrictions and protection against documented classes of tampering | That our actual provider is correctly signed/configured and that supported attacks do not recover the canary plaintext |
| SIP / macOS process security | Host-level protections around protected processes | That our process is actually covered and that our attack suite has no supported recovery path |
| Developer ID | Publisher/code-signing identity recognized by Gatekeeper | That the deployed provider matches the approved identity/hash and deployment procedure |
| Notarization | Automated Apple security checks and notarization ticket | That the exact artifact we distribute is the artifact we tested and approved |
| Core-dump configuration | macOS/provider controls can restrict crash artifacts | That no supported crash path leaves the canary plaintext behind |
| App Sandbox | Restricts application access to resources | That sandboxing, if used, does not break inference and reduces leakage surface |
| Virtualization.framework | First-party VM isolation APIs on Apple Silicon | A future VM-backed profile would need its own threat model and attack evidence |

The security argument is therefore **composition + verification**, not "Apple says this process is confidential."

## 12. Apple Silicon alpha assumptions

The initial implementation currently relies on macOS mechanisms including:

- Hardened Runtime.
- SIP.
- `PT_DENY_ATTACH` as an additional defense where present.
- Disabled/restricted core dumps.
- Code signing for the production distribution path.
- OCIP encrypted transport for consumer/provider request confidentiality.

`PT_DENY_ATTACH` is treated as defense-in-depth rather than the foundation of L2. The primary platform claim should rest on documented macOS security controls and the attack results, not on a single anti-debugging call.

The exact effectiveness of each mechanism must be demonstrated by attack tests. In particular, tests must distinguish:

1. A mechanism being configured.
2. A mechanism actually preventing the intended attack.
3. A mechanism preventing the attack for the entire inference data path, including GPU/unified memory where applicable.

## 13. Availability is not confidentiality

An L2 operator can still:

- Kill the provider.
- Restart it.
- Disconnect it from the network.
- Prevent it from serving requests.
- Potentially observe resource-usage metadata.

These are availability/metadata capabilities and do not violate the L2 confidentiality claim.

## 14. Integrity claim

L2 should **not** currently be advertised as providing strong end-to-end integrity against a malicious provider operator.

Process hardening can prevent an operator from modifying an already-running protected process through supported mechanisms, but it cannot by itself prove that the process that was launched was the intended implementation.

Strong remote runtime integrity requires an additional provider-authentication/attestation mechanism.

For Public Alpha, the safe claim is therefore:

> L2 provides process-level confidentiality against supported local OS inspection of an approved runtime; it does not provide hardware-backed remote attestation or proof of honest provider behavior.

## 15. Test methodology

Security tests should use a known secret prompt that is not otherwise present on the machine, for example a randomly generated marker.

Each attack test should attempt to recover that marker rather than merely checking whether a command returned an error.

For each test record:

- Platform and OS version.
- Hardware model.
- Provider build identifier/hash.
- Security configuration state.
- Apple signing identity / designated code identity where applicable.
- Attack command/tool used.
- Whether the attack obtained plaintext.
- Relevant logs/output.
- Pass/fail result.

A command returning `EPERM`, `denied`, or another error is useful evidence but is not by itself sufficient if another supported path can still recover the secret.

## 16. L2 acceptance boundary

The Public Alpha L2 label is acceptable only when:

1. The provider passes its platform self-test.
2. The installed production artifact satisfies the Apple Silicon L2 profile.
3. The documented attack suite passes.
4. No known supported user-space/OS inspection path recovers the test secret.
5. Logging and artifact paths have been audited.
6. The exact tested build is tied to the documented code identity/hash.
7. The limitations in this document are publicly disclosed.
8. The provider is not represented as hardware-confidential or remotely attested unless those properties are separately verified.

## 17. Relationship to higher levels

L2 is intentionally weaker than hardware-backed confidential computing.

- **L2:** relies on OS/process isolation and assumes the kernel/platform security boundary holds.
- **L3:** moves the confidentiality boundary into hardware-enforced encrypted memory / TEE mechanisms.
- **L4:** additionally protects accelerator memory and the broader inference pipeline with hardware-backed confidential computing.

Therefore L2 should be marketed as protection against the **ordinary local operator**, not protection against a compromised kernel or physical attacker.

Apple's Virtualization framework is a potential future isolation mechanism, but use of a VM API alone would not automatically turn a provider into L2; the VM configuration, guest, host assumptions, and attack surface would still require independent validation.

## 18. Open questions before declaring L2 proven

- [ ] Exactly which macOS APIs/tools can an administrator use to inspect another process under the supported configuration?
- [ ] Does the chosen llama.cpp/Metal execution path place sensitive inference state in GPU/unified memory that has an independently testable protection boundary?
- [ ] Can an administrator launch a modified/unsigned replacement provider while bypassing the intended deployment controls?
- [ ] What exact code identity is checked for a production provider?
- [ ] Can the coordinator or consumer independently verify that identity?
- [ ] What crash-reporting mechanisms could capture plaintext?
- [ ] What telemetry/debugging facilities are enabled by default?
- [ ] Which claims can be tested automatically in CI versus only on a real Apple Silicon security-test host?

These questions are blockers for stronger wording, but they do not need to be solved by the same mechanism. The threat model should remain explicit about what is known, what is tested, and what is still an assumption.
