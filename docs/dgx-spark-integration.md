# NVIDIA DGX Spark Integration — Hardware Security & Provider Architecture

**Status:** Research & proposal for issue creation
**Related docs:** [Apple Silicon hardening (archived)](archive/apple-silicon-hardening.md), [Linux hardening (archived)](archive/linux-hardening.md), [Windows hardening (archived)](archive/windows-hardening.md), [current threat model](security/threat-model.md), [primitives matrix (archived)](archive/primitives-matrix.md)

---

## 1. What Is DGX Spark

NVIDIA DGX Spark is a personal AI supercomputer announced at GTC 2025
(shipping mid-2025). It pairs the **Grace Blackwell GB10 Superchip**
with a desktop form factor roughly the size of a Mac Studio.

### 1.1 Hardware Specs

| Property | DGX Spark |
|---|---|
| Chip | GB10 (Grace ARM CPU + Blackwell GPU on one package) |
| GPU | Blackwell-class, 1 PFLOP FP4 AI performance |
| Memory | 128 GB unified (LPDDR5X shared CPU/GPU, coherent via NVLink-C2C) |
| NVLink-C2C | On-chip CPU↔GPU interconnect (900 GB/s bidirectional) |
| Connectivity | 10GbE, WiFi 7, USB4/Thunderbolt, PCIe Gen5 |
| OS | NVIDIA DGX OS (Ubuntu-based Linux) |
| Software | NVIDIA AI Enterprise, NIM containers, CUDA |
| Form factor | Desktop (Mac Studio–sized) |
| Price | ~$3,000 starting |
| Target | Developers, researchers, small teams |

### 1.2 Key Architectural Similarities to Apple Silicon

The GB10's memory model is **strikingly similar** to Apple Silicon:

| Property | Apple Silicon (M4 Ultra) | DGX Spark (GB10) |
|---|---|---|
| Memory architecture | Unified (shared CPU/GPU) | Unified (shared via NVLink-C2C) |
| CPU–GPU interconnect | On-die fabric | NVLink Chip-to-Chip (900 GB/s) |
| Memory | Up to 192 GB LPDDR5X | 128 GB LPDDR5X |
| Bandwidth | Up to 800 GB/s | ~250–300 GB/s (estimated) |
| GPU compute | Metal | CUDA / NIM |
| OS | macOS (closed) | DGX OS / Ubuntu (open, Linux) |

The unified memory means the same model-size advantage as Apple Silicon —
a 70B model can load entirely into the shared memory pool without PCIe
transfer bottlenecks. But the Linux foundation opens different hardening
paths.

### 1.3 DGX Spark Clustering (ConnectX)

DGX Spark units can be **linked together** via NVIDIA ConnectX networking:

- **Two DGX Sparks via ConnectX:** 256 GB unified pool, tensor parallelism
  across both nodes via NVLink over Ethernet
- **Possible topology:** DGX Spark cluster → network switch → coordinator

NVIDIA's documentation describes "Project Digits" (DGX Spark's original
name) as supporting linking two units together for 1 PFLOP combined AI
compute. The interconnect uses standard Ethernet (10GbE or potentially
higher via ConnectX-7) with NVIDIA's GPU-Direct RDMA for low-latency
tensor transfer.

### 1.4 Provider Connectivity — How Users Actually Set Up DGX Spark

Based on NVIDIA's positioning and the DGX Spark's connectivity options:

**Standalone DGX Spark provider:**
```
DGX Spark (GB10, DGX OS)
  ├── 10GbE / WiFi 7 → Internet → Coordinator
  ├── Inference engine (TensorRT-LLM / vLLM / llama.cpp)
  └── OCIP Agent (runs natively on ARM Linux)
```

**DGX Spark with Mac Mini/Studio as network front-end:**
```
Mac Mini/Studio (coordinator relay / agent host?)
  └── USB4/Thunderbolt or 10GbE → DGX Spark (inference only)
```

This is the topology you mentioned — some users might front a DGX Spark
with a Mac for the familiar macOS environment, running the OCIP agent
on the Mac and the inference server on the DGX Spark. This creates a
**split trust boundary** problem (see §4.3).

**Clustered DGX Sparks:**
```
DGX Spark A ←── ConnectX (10GbE/RDMA) ──→ DGX Spark B
     └── Combined 256 GB, tensor parallelism
     └── One OCIP Agent instance managing both
     └── 10GbE → Internet → Coordinator
```

---

## 2. Security Primitives Available on DGX Spark

### 2.1 What DGX OS / Linux Provides

DGX OS is Ubuntu-based. The Linux kernel provides:

| Primitive | Mechanism | Equivalent to macOS? |
|---|---|---|
| Anti-debug | `prctl(PR_SET_DUMPABLE, 0)` — blocks `/proc/pid/mem` reads | Weaker than PT_DENY_ATTACH (root can override via kernel) |
| Anti-trace | `prctl(PR_SET_DUMPABLE, 0)` + seccomp | Weaker (root can load kernel modules) |
| Core dump disable | `setrlimit(RLIMIT_CORE, 0)` | Same |
| Kernel lockdown | `lockdown=confidentiality` boot parameter | Similar to SIP but not as strong |
| Secure Boot | UEFI Secure Boot chain | Similar to Apple Secure Boot |
| dm-verity | Read-only verified root filesystem | Stronger than macOS SIP for rootfs |
| AppArmor/SELinux | Mandatory Access Control | No macOS equivalent (SIP is simpler) |
| Namespace isolation | User/mount/PID namespaces | No macOS equivalent |
| seccomp-BPF | Syscall filtering | No direct macOS equivalent |
| TPM 2.0 | Hardware key storage + attestation | Similar role to Secure Enclave |

### 2.2 What the ARM Grace CPU Provides

The Grace CPU is ARM Neoverse V2-based and includes:

- **ARM TrustZone:** Hardware-isolated secure world for key storage and
  cryptographic operations. Functional equivalent to Apple's Secure
  Enclave, though architecturally different (TrustZone partitions the
  CPU itself; SEP is a separate coprocessor).
- **ARM Confidential Compute Architecture (CCA) / Realms:** Hardware-
  isolated execution environments analogous to AMD SEV-SNP or Intel TDX.
  If enabled in the GB10, this would allow running inference inside a
  hardware-encrypted VM ("Realm") where even the hypervisor/host OS
  cannot read the VM's memory.
- **ARM Pointer Authentication (PAC):** Hardware control-flow integrity.
  Not directly relevant to confidentiality but hardens against code
  injection attacks.
- **ARM Memory Tagging Extension (MTE):** Hardware memory safety.
  Prevents certain classes of memory corruption exploits.

**Critical question (unconfirmed):** Whether the GB10 specifically
enables ARM CCA/Realms is not yet confirmed in NVIDIA's public
documentation. If it does, this would provide a direct path to L3
(hardware-encrypted memory) that AMD SEV-SNP provides on x86.

### 2.3 What the Blackwell GPU Provides

NVIDIA Blackwell GPUs (B100, B200, GB200) support **NVIDIA Confidential
Computing (CC)**:

- GPU memory (HBM/LPDDR5X) encryption at the hardware level
- GPU attestation via NVIDIA's attestation service
- Secure boot of the GPU firmware
- Protection against physical memory probing

**Key question for DGX Spark:** The full Blackwell data center GPUs (B100,
B200) support CC. Whether the GB10's integrated Blackwell GPU supports
the same CC features is **not yet confirmed**. NVIDIA's consumer/edge
products have historically omitted CC features that are available in
data center SKUs. This is the single most important unknown for our
security story.

**If GB10 supports NVIDIA CC:**
- CPU memory encrypted via ARM CCA (if available) or Linux kernel lockdown
- GPU memory encrypted via NVIDIA CC hardware
- Combined: true L3 with GPU acceleration — the holy grail

**If GB10 does NOT support NVIDIA CC:**
- CPU memory protected via VM isolation (KVM) or process hardening
- GPU memory is the weak link — shared memory architecture means the
  CPU-side protections extend to GPU memory (unlike discrete GPU setups),
  but without hardware encryption, a kernel exploit exposes everything
- This lands at L2, comparable to Apple Silicon's Hardened Runtime

### 2.4 TPM 2.0 — The Attestation Anchor

DGX systems include a **TPM 2.0** chip. This is the direct equivalent
of Apple's App Attest / Secure Enclave attestation:

| Property | Apple App Attest + SE | TPM 2.0 |
|---|---|---|
| Key generation | Secure Enclave | TPM |
| Key storage | Secure Enclave (non-extractable) | TPM (non-extractable) |
| Attestation chain | Apple CA → App Attest → key binding | TPM manufacturer CA → EK cert → AIK |
| Remote attestation | Coordinator verifies via Apple CA | Coordinator verifies via TPM manufacturer CA |
| Platform measurement | Not applicable (App Attest is app-level) | PCR measurements (boot chain, OS, loaded software) |
| What it proves | "This app is running on genuine Apple hardware" | "This exact software stack booted on this physical TPM" |

TPM 2.0 actually provides **stronger attestation** than Apple App Attest
for our use case:

1. **Platform Configuration Registers (PCRs):** The TPM measures the
   entire boot chain — UEFI firmware → bootloader → kernel → initramfs →
   critical system files. The coordinator can verify not just "this is
   real NVIDIA hardware" but "this exact kernel + this exact OS config
   booted on this hardware."

2. **Measured Boot:** Each stage measures the next before executing it.
   A provider who modifies the kernel (e.g., loads a kernel module to
   read process memory) changes the PCR values, and the attestation
   fails.

3. **Quote signing:** The TPM signs a "quote" (set of PCR values +
   nonce) with its Attestation Identity Key (AIK). The coordinator
   verifies the quote against known-good PCR values for the official
   DGX OS image.

### 2.5 NVIDIA Attestation Service

NVIDIA provides a cloud attestation service for DGX and NVIDIA AI
Enterprise platforms:

- **NVIDIA Remote Attestation Service (NRAS):** Verifies GPU authenticity,
  GPU firmware integrity, and (if CC enabled) the confidential computing
  environment. Uses NVIDIA's root CA.
- **Local GPU attestation:** The GPU can produce a signed attestation
  report (GPU firmware version, driver version, CC mode enabled/disabled)
  verifiable against NVIDIA's published certificates.

This gives us a two-chain attestation model:
1. **TPM chain:** Platform (CPU + OS + boot chain) → TPM manufacturer CA
2. **GPU chain:** GPU (firmware + driver + CC mode) → NVIDIA CA

Both chains would need to verify for L2+.

---

## 3. Defense-in-Depth Hardening Architecture

### 3.1 Tier Map — DGX Spark vs Apple Silicon

| Tier | Apple Silicon | DGX Spark | Security Level |
|---|---|---|---|
| A | PT_DENY_ATTACH + Hardened Runtime + SIP | KVM + kernel lockdown + seccomp + dm-verity | L2 |
| B | (not possible on macOS) | KVM + kernel lockdown + NVIDIA CC (if available) | L2.5 |
| C | (not possible on macOS) | ARM CCA Realm (if GB10 supports it) + NVIDIA CC | L3 |
| D | App Attest (Apple CA) | TPM 2.0 (manufacturer CA) + NRAS (NVIDIA CA) | Attestation |

### 3.2 Recommended Architecture — L2 (Proven Path, No CC)

This is the baseline that works regardless of whether GB10 supports
confidential computing features. Defense in depth using Linux isolation
primitives.

```
┌──────────────────────────────────────────────────────────────────┐
│  DGX Spark (GB10, DGX OS)                                        │
│                                                                   │
│  ┌───────── Hardened Namespace / KVM Guest ──────────────────┐   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  OCIP Inference Server                               │  │   │
│  │  │  (llama.cpp or TensorRT-LLM with CUDA)               │  │   │
│  │  │                                                      │  │   │
│  │  │  Defense layers (inside-out):                        │  │   │
│  │  │  1. prctl(PR_SET_DUMPABLE, 0)  — no /proc/pid/mem   │  │   │
│  │  │  2. seccomp-BPF — block ptrace, process_vm_readv     │  │   │
│  │  │  3. RLIMIT_CORE = 0 — no core dumps                 │  │   │
│  │  │  4. Locked memory pages (mlock + madvise DONTDUMP)   │  │   │
│  │  │  5. Signal handler for SIGTRAP (anti-debug canary)   │  │   │
│  │  │                                                      │  │   │
│  │  │  Listens on: Unix socket (namespace-local)           │  │   │
│  │  │  GPU access: direct CUDA (unified memory, in-namespace) │ │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  OCIP Agent                                          │  │   │
│  │  │  (frozen binary, same namespace)                     │  │   │
│  │  │                                                      │  │   │
│  │  │  • WebSocket → coordinator                           │  │   │
│  │  │  • X25519 decrypt/encrypt                            │  │   │
│  │  │  • TPM 2.0 attestation (via tpm2-tools)              │  │   │
│  │  │  • NVIDIA GPU attestation (via nvidia-attestation)   │  │   │
│  │  │  • Same process hardening as inference server        │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  │  OS-level defenses:                                       │   │
│  │  • Kernel lockdown=confidentiality (no /dev/mem, no kprobes)│  │
│  │  • dm-verity on rootfs (tamper-evident, read-only)        │   │
│  │  • AppArmor profile (deny ptrace, deny /proc/*/mem write) │   │
│  │  • Secure Boot chain verified by TPM                      │   │
│  │  • No SSH / no shell access inside the namespace          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Host layer (operator-accessible):                                │
│  • Can see namespace exists, resource usage                       │
│  • CANNOT read namespace process memory (kernel lockdown)         │
│  • CANNOT load kernel modules (Secure Boot + lockdown)            │
│  • CANNOT modify rootfs (dm-verity)                               │
│  • CAN kill the namespace (DoS only, not confidentiality)         │
│                                                                   │
│  To break: kernel 0-day exploit on locked-down DGX OS             │
│  (comparable to macOS kernel exploit, ~$250k–$500k)               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Attack Surface Analysis

| Attack | macOS L2 (Apple Silicon) | DGX Spark L2 (this design) |
|---|---|---|
| Debugger attach | Blocked (PT_DENY_ATTACH, permanent) | Blocked (seccomp + PR_SET_DUMPABLE + AppArmor) |
| Read /proc/pid/mem | N/A (no /proc on macOS) | Blocked (kernel lockdown + AppArmor) |
| process_vm_readv() | N/A | Blocked (seccomp filter) |
| Load kernel module to read memory | Blocked (SIP, Apple Silicon kext ban) | Blocked (Secure Boot + kernel lockdown + dm-verity) |
| Modify OS to weaken protections | Blocked (SIP) | Blocked (dm-verity read-only rootfs) |
| Replace inference binary | Blocked (code signature + Gatekeeper) | Blocked (dm-verity + binary hash in TPM PCR) |
| Inject shared library | Blocked (Hardened Runtime blocks DYLD_INSERT) | Blocked (seccomp + LD_PRELOAD blocked in namespace) |
| Core dump | Blocked (RLIMIT_CORE) | Blocked (RLIMIT_CORE + seccomp) |
| Network sniff localhost | Unix socket (no network) | Unix socket (namespace-local) |
| GPU memory observation | GPU shares die with CPU (no PCIe BAR) | GPU shares memory via NVLink-C2C (same protection model) |
| Physical RAM probe | Infeasible (Apple Silicon SoC packaging) | Possible but impractical (LPDDR5X soldered, no DIMM slots) |

### 3.4 The GPU Memory Question

On DGX Spark, the GB10's GPU and CPU share memory via NVLink-C2C. This is
fundamentally different from discrete GPU setups (where GPU memory is on
separate VRAM behind a PCIe bus):

**Discrete GPU (e.g., RTX 4090):**
- GPU has its own VRAM (24 GB HBM/GDDR6)
- Host reads GPU memory via PCIe BAR mappings → host CAN observe GPU contents
- VFIO passthrough blocks host access by remapping the IOMMU
- But host kernel still controls the IOMMU → kernel exploit can remap

**DGX Spark (GB10 unified):**
- CPU and GPU share the same LPDDR5X pool
- NVLink-C2C provides coherent access (no PCIe BAR indirection)
- Process hardening (seccomp, lockdown) that protects CPU memory
  *automatically protects GPU memory* because it's the same physical pages
- No separate "GPU memory leak" vector — if the kernel can't read the
  process's pages, it can't read the GPU tensors either

This is a significant security advantage over discrete GPU setups and
mirrors Apple Silicon's unified memory model. It means **L2 on DGX Spark
protects GPU memory by default**, unlike Linux+RTX4090 where GPU memory
is a separate attack surface.

### 3.5 Architecture for L3 (If GB10 Supports ARM CCA + NVIDIA CC)

```
┌──────────────────────────────────────────────────────────────────┐
│  DGX Spark (GB10)                                                │
│                                                                   │
│  ┌──────────────── ARM CCA Realm (Hardware Encrypted) ────────┐  │
│  │                                                             │  │
│  │  ALL memory encrypted by hardware (AES, per-Realm key)     │  │
│  │  Hypervisor CANNOT read Realm memory                       │  │
│  │                                                             │  │
│  │  OCIP Agent + Inference Server                             │  │
│  │  • Full CUDA access (unified memory inside Realm)          │  │
│  │  • 128 GB available                                        │  │
│  │  • NVIDIA CC encrypts GPU-side state                       │  │
│  │                                                             │  │
│  │  Attestation: ARM CCA attestation token + NVIDIA NRAS      │  │
│  │  Verifiable by: Coordinator against ARM + NVIDIA CAs       │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Host/hypervisor sees: ciphertext only                            │
│  To break: ARM CCA hardware vulnerability (no known exploits)     │
└──────────────────────────────────────────────────────────────────┘
```

This would be the first L3 configuration with **full GPU acceleration**.
Currently, AMD SEV-SNP at L3 is CPU-only (no GPU inside the CVM). If
the GB10 supports ARM CCA + NVIDIA CC, DGX Spark would be the first
consumer-priced device capable of L3 inference with GPU speed.

---

## 4. Attestation Design

### 4.1 Dual-Chain Attestation

DGX Spark attestation would use two independent chains, both verified
by the coordinator:

```
Chain 1: Platform (TPM 2.0)
  TPM Manufacturer CA
    └── Endorsement Key Certificate (EK cert)
        └── Attestation Identity Key (AIK, created on TPM)
            └── Quote: signed(PCR_values + nonce)
                PCR[0]: UEFI firmware measurement
                PCR[1]: UEFI configuration
                PCR[4]: Boot loader measurement (GRUB/systemd-boot)
                PCR[5]: Partition table
                PCR[7]: Secure Boot state
                PCR[8]: Kernel + initramfs measurement
                PCR[9]: Kernel command line (lockdown=confidentiality)
                PCR[14]: Custom: OCIP agent binary hash
                PCR[15]: Custom: Inference server binary hash

Chain 2: GPU (NVIDIA)
  NVIDIA Root CA
    └── GPU Attestation Certificate
        └── Attestation Report:
            - GPU model (GB10)
            - Driver version
            - Firmware version
            - CC mode (enabled/disabled)
            - Nonce binding
```

### 4.2 Coordinator Verification Flow

```
Provider connects → registration → coordinator challenges:

1. TPM Quote:
   Coordinator sends: {nonce, expected_pcr_policy}
   Provider responds: {tpm_quote, tpm_signature, aik_cert, ek_cert}

   Coordinator verifies:
   a. EK cert chains to known TPM manufacturer CA
   b. AIK is bound to the EK (privacy CA or direct)
   c. Quote signature verifies against AIK
   d. PCR values match known-good DGX OS image + OCIP binaries
   e. Nonce matches (freshness)

2. GPU Attestation:
   Coordinator sends: {nonce}
   Provider responds: {gpu_attestation_report, nvidia_cert_chain}

   Coordinator verifies:
   a. Cert chain to NVIDIA Root CA
   b. GPU model is GB10 (expected hardware)
   c. Driver/firmware versions in approved set
   d. CC mode matches claimed trust level
   e. Nonce matches

3. Combined verdict:
   TPM quote valid + GPU attestation valid + PCRs match
   → Trust level assigned based on CC mode:
     - CC off, lockdown on → L2 (kernel exploit required)
     - CC on (ARM CCA + NVIDIA CC) → L3 (hardware exploit required)
```

### 4.3 Split Trust Boundary — Mac Front-End + DGX Spark Backend

If a provider runs the OCIP agent on a Mac Mini/Studio and the inference
engine on a DGX Spark:

```
Mac Mini (macOS)                    DGX Spark (DGX OS)
┌──────────────────┐               ┌──────────────────┐
│ OCIP Agent       │  USB4/10GbE   │ Inference Server  │
│ • WS to coord    │──────────────▶│ • CUDA inference  │
│ • Decryption     │               │ • Streams tokens  │
│ • Attestation    │               │                   │
└──────────────────┘               └──────────────────┘
```

**This topology has a critical security problem:**

The **plaintext exists on the Mac** (the agent decrypts there) and
travels over USB4/10GbE to the DGX Spark. This means:
- The Mac must be hardened (PT_DENY_ATTACH + Hardened Runtime)
- The link between Mac and DGX Spark must be encrypted (TLS or NaCl)
- The trust claim is only as strong as the **weaker** of the two devices
- Two different attestation chains (Apple CA for Mac, TPM for DGX Spark)
- More attack surface than a single-device setup

**Recommendation:** Discourage this topology. The OCIP agent should run
**on the DGX Spark itself**. The DGX Spark runs ARM Linux, and the OCIP
agent is Python — it runs natively. There is no technical reason to
split the trust boundary across two devices.

If the user insists on using a Mac as a front-end (e.g., for familiar
macOS UX), the Mac should run a **thin relay** that does NOT decrypt —
just forwards encrypted WebSocket frames to the DGX Spark where the real
agent lives. This keeps the trust boundary on one device.

```
Preferred: Single trust boundary
  DGX Spark: [Agent + Inference] ←──WSS──→ Coordinator

Acceptable: Mac relay (no decryption on Mac)
  Mac: [Thin WS relay] ←─encrypted─→ DGX Spark: [Agent + Inference]
       ↕ WSS
  Coordinator

NOT recommended: Mac agent (split trust boundary)
  Mac: [Agent with keys] ──plaintext──→ DGX Spark: [Inference only]
       ↕ WSS
  Coordinator
```

### 4.4 Clustered DGX Sparks — Additional Caveats

When two DGX Sparks are linked via ConnectX for tensor parallelism:

```
DGX Spark A                           DGX Spark B
┌──────────────┐   ConnectX (RDMA)   ┌──────────────┐
│ GPU A: layers │ ←────────────────→ │ GPU B: layers │
│ 0-15          │   tensor parallel  │ 16-31         │
│               │                    │               │
│ Agent         │                    │ (no agent)    │
└──────────────┘                    └──────────────┘
```

**Security implications:**

1. **Inter-node traffic is plaintext tensors.** The intermediate
   activations traveling between the two GPUs via ConnectX are plaintext
   model state. An attacker who can sniff the ConnectX link sees partial
   inference computation. This is analogous to the localhost HTTP
   traffic between agent and inference server — the same trust boundary
   argument applies.

2. **Both nodes must be attested.** The coordinator should require TPM
   quotes from BOTH DGX Sparks, not just the one running the agent.
   A provider could have one legitimate DGX Spark and one compromised
   machine.

3. **ConnectX link must be on an isolated network.** The RDMA traffic
   should not be on the same physical network as internet-facing
   traffic. A VLAN or dedicated link is minimum; IPsec/MACsec
   encryption of the RDMA traffic is better.

4. **The trust level is the minimum of both nodes.** If Spark A is L2
   and Spark B is L1 (e.g., lockdown disabled), the combined system is
   L1.

5. **Attestation protocol change:** The registration message needs a
   new field for multi-node setups:

   ```json
   {
     "topology": "cluster",
     "nodes": [
       {"node_id": "spark-a", "tpm_quote": "...", "gpu_attestation": "..."},
       {"node_id": "spark-b", "tpm_quote": "...", "gpu_attestation": "..."}
     ],
     "inter_node_encryption": "ipsec" | "macsec" | "none",
     "interconnect": "connectx-10gbe"
   }
   ```

---

## 5. Implementation Plan

### 5.1 Phase 1 — Linux ARM64 Agent Build (prerequisite)

Before DGX Spark-specific work, we need a Linux ARM64 OCIP agent:

- [ ] PyInstaller build for `linux-aarch64`
- [ ] Process hardening for Linux (`prctl` + `seccomp` + `RLIMIT_CORE`)
- [ ] CI pipeline for Linux ARM64 (GitHub Actions ARM runner or cross-compile)
- [ ] Linux-specific attestation stub (returns platform info, no TPM yet)
- [ ] Binary hash published to release manifest

**Difficulty:** Medium. The agent is Python — PyInstaller cross-platform
is straightforward. The hardening is different code paths from macOS.

### 5.2 Phase 2 — DGX OS Hardening Profile

DGX OS-specific hardening configuration:

- [ ] `kernel lockdown=confidentiality` in boot parameters
- [ ] AppArmor profile for OCIP agent + inference server
- [ ] seccomp-BPF filter (block ptrace, process_vm_readv, kcmp,
  perf_event_open, kexec_load, etc.)
- [ ] dm-verity for read-only rootfs (or at minimum read-only /usr)
- [ ] Secure Boot verification in attestation response
- [ ] Systemd unit with `ProtectSystem=strict`, `PrivateDevices=false`
  (need GPU access), `NoNewPrivileges=true`, `RestrictNamespaces=true`

**Difficulty:** Medium. Standard Linux hardening, well-documented.

### 5.3 Phase 3 — TPM 2.0 Attestation

- [ ] TPM key generation (EK + AIK provisioning)
- [ ] PCR measurement protocol (extend PCR[14] with agent binary hash,
  PCR[15] with server binary hash)
- [ ] TPM Quote generation (tpm2-tools or go-tpm library)
- [ ] Coordinator-side TPM quote verification
- [ ] Known-good PCR value database (per DGX OS version + OCIP version)
- [ ] Integration into the existing attestation challenge/response flow

**Difficulty:** High. TPM attestation is well-specified but has a large
surface area (key provisioning, PCR policies, quote formats, cert chain
verification). Libraries exist (tpm2-tools, go-tpm, python-tpm2-pytss)
but integration is non-trivial.

### 5.4 Phase 4 — NVIDIA GPU Attestation

- [ ] Integration with NVIDIA Attestation SDK (`nvidia-attestation` package)
- [ ] GPU attestation report generation on provider side
- [ ] Coordinator-side GPU attestation verification against NVIDIA CA
- [ ] CC mode detection and reporting
- [ ] GPU firmware/driver version allowlist

**Difficulty:** Medium-High. Depends on NVIDIA SDK availability for GB10
at launch. Data center GPU attestation (H100/H200) is documented; GB10
support may lag.

### 5.5 Phase 5 — Cluster Attestation (if clustering is supported)

- [ ] Multi-node registration protocol
- [ ] Per-node TPM + GPU attestation
- [ ] Inter-node encryption verification
- [ ] Combined trust level computation (minimum of all nodes)
- [ ] Topology reporting to coordinator

**Difficulty:** Medium. Extends Phase 3-4 to multiple nodes.

### 5.6 Phase 6 — ARM CCA / NVIDIA CC (L3, future)

Contingent on GB10 actually supporting these features:

- [ ] ARM CCA Realm provisioning and attestation
- [ ] NVIDIA CC mode enablement on GB10
- [ ] Combined CCA + CC attestation chain
- [ ] L3 trust level assignment in coordinator

**Difficulty:** High. Depends on hardware capability that is not yet
confirmed.

---

## 6. OCIP Protocol Changes

### 6.1 New Trust Profile

Add `nvidia-dgx-spark-l2` alongside existing `apple-l2-hardened`:

```python
class TrustProfile(str, Enum):
    OPEN = "open"                          # L0
    CONTAINED = "contained"                # L1
    APPLE_L2 = "apple-l2-hardened"         # L2 (macOS)
    LINUX_KVM_L2 = "linux-kvm-l2"          # L2 (KVM+VFIO, existing design)
    DGX_SPARK_L2 = "dgx-spark-l2"          # L2 (DGX Spark, new)
    DGX_SPARK_L3 = "dgx-spark-l3"          # L3 (DGX Spark + CCA + CC, future)
    SEV_SNP_L3 = "sev-snp-l3"             # L3 (AMD SEV-SNP, existing design)
```

### 6.2 Attestation Extension

The `AttestationResponse` message needs platform-specific evidence:

```python
class AttestationResponse(BaseModel):
    nonce: str
    platform: str                          # "macos", "linux", "dgx-os"

    # macOS-specific (existing)
    sip_enabled: Optional[bool]
    hardened_runtime: Optional[bool]
    pt_deny_attach: Optional[bool]

    # Linux/DGX-specific (new)
    kernel_lockdown: Optional[str]         # "none", "integrity", "confidentiality"
    secure_boot: Optional[bool]
    dm_verity: Optional[bool]
    apparmor_enforcing: Optional[bool]
    seccomp_active: Optional[bool]

    # TPM attestation (new)
    tpm_quote: Optional[str]               # Base64-encoded TPM2 quote
    tpm_signature: Optional[str]           # Quote signature
    tpm_aik_cert: Optional[str]            # AIK certificate chain
    tpm_pcr_values: Optional[Dict[int, str]]  # PCR index → value

    # NVIDIA GPU attestation (new)
    gpu_attestation_report: Optional[str]  # Base64-encoded NVIDIA attestation
    gpu_cert_chain: Optional[str]          # NVIDIA cert chain
    gpu_cc_mode: Optional[bool]            # Confidential Computing enabled?

    # Common (existing)
    agent_binary_hash: str
    server_binary_hash: str
    agent_version: str
    server_engine: str
    platform_version: str
    chip_model: Optional[str]              # "gb10", "m4-pro", etc.

    # Cluster (new, optional)
    topology: Optional[str]                # "standalone" | "cluster"
    cluster_nodes: Optional[List[ClusterNodeAttestation]]
```

### 6.3 Provider Offer Extension

Consumer-facing offer data should include hardware details:

```python
class ProviderOffer(BaseModel):
    # ... existing fields ...
    hardware_platform: str         # "apple-m4-pro", "dgx-spark-gb10", etc.
    gpu_type: str                  # "metal", "cuda-gb10", "cuda-rtx4090"
    memory_gb: int                 # 128 for DGX Spark
    attestation_chains: List[str]  # ["apple-ca"], ["tpm-manufacturer", "nvidia-ca"]
```

---

## 7. Comparison — Where DGX Spark Fits in the Provider Landscape

| Property | Mac Studio M4 Ultra | DGX Spark (GB10) | Linux + RTX 4090 |
|---|---|---|---|
| Price | ~$4,000–$8,000 | ~$3,000 | ~$2,500–$3,500 |
| Memory | 128–192 GB unified | 128 GB unified | 24 GB VRAM + system RAM |
| Best L2 path | Hardened Runtime (trivial) | Kernel lockdown + seccomp (medium) | KVM+VFIO (medium) |
| L3 possible? | No | Maybe (ARM CCA + NVIDIA CC) | Yes (AMD SEV-SNP, CPU only) |
| GPU at L3? | No | Maybe (if CC supported) | No (VFIO at L2 only) |
| Attestation anchor | Apple CA (App Attest) | TPM 2.0 + NVIDIA CA | TPM 2.0 (no GPU CA) |
| Max model size (L2) | ~120B Q4 (192 GB) | ~90B Q4 (128 GB) | ~14B Q4 (24 GB VRAM) |
| Inference speed | Metal (fast) | CUDA (fast, 1 PFLOP FP4) | CUDA (fast) |
| Clustering | Not supported | 2-node via ConnectX | Not supported natively |
| Setup complexity | Low (codesign + entitlements) | Medium (kernel lockdown + TPM) | Medium (KVM+VFIO) |
| OS control | Limited (Apple controls macOS) | Full (Linux, open) | Full (Linux, open) |

### 7.1 Unique Value Proposition

DGX Spark fills a gap no other hardware covers:

1. **Consumer-priced L3 candidate with GPU.** If ARM CCA + NVIDIA CC are
   supported, DGX Spark would be the only sub-$5,000 device capable of
   hardware-encrypted inference with full GPU speed. Mac can't do L3.
   RTX 4090 + SEV-SNP can do L3 but CPU-only.

2. **128 GB unified memory at $3,000.** Can run 70B models at L2 with
   full GPU acceleration. A Mac Studio with 192 GB is $4,000–$8,000.

3. **Linux-native.** No Apple Developer Program ($99/yr). No notarization.
   Open toolchain. TPM attestation uses open standards (TCG specs).

4. **Clustering for large models.** Two DGX Sparks = 256 GB, enough for
   405B Q4. No Apple Silicon clustering equivalent.

---

## 8. Open Questions & Risks

### 8.1 Confirmed Unknowns

1. **Does GB10 support ARM CCA / Realms?**
   Impact: Determines if L3 is possible. Without CCA, DGX Spark is L2
   max (still valuable, but not the holy grail).

2. **Does GB10's Blackwell GPU support NVIDIA Confidential Computing?**
   Impact: GPU memory encryption. Without CC, GPU memory is protected
   only by process-level isolation (sufficient for L2, not L3).

3. **Exact memory bandwidth of GB10?**
   Impact: Inference speed estimates for pricing model. NVIDIA hasn't
   published detailed bandwidth numbers for the LPDDR5X configuration.

4. **ConnectX clustering — what interconnect speed?**
   Impact: Tensor parallelism overhead for clustered setups. 10GbE is
   slow for RDMA tensor transfer; 100GbE ConnectX-7 would be much better.

5. **DGX OS kernel lockdown mode — is it `confidentiality` by default?**
   Impact: If DGX OS ships with lockdown=confidentiality, L2 hardening
   is much simpler. If it's off by default, providers need to configure
   it.

6. **NVIDIA Attestation SDK availability for GB10?**
   Impact: Timeline for Phase 4. Data center GPU attestation exists;
   consumer/edge GPU attestation may not be available at launch.

### 8.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GB10 doesn't support ARM CCA | Medium | L3 not possible | L2 is still valuable; revisit with future hardware |
| GB10 doesn't support NVIDIA CC | Medium-High | GPU memory not hardware-encrypted | Unified memory + process hardening still covers L2 |
| DGX Spark ships later than mid-2025 | Medium | Delays implementation | Start with generic Linux ARM64 work (Phase 1-2) |
| TPM attestation complexity | Low | Development time | Well-documented standards; libraries exist |
| ConnectX clustering is flaky | Medium | Multi-node setups unreliable | Recommend standalone mode first; cluster as advanced |
| NVIDIA changes DGX OS significantly | Low | Hardening config breaks | Pin to specific DGX OS versions with known-good PCRs |

---

## 9. Suggested Issue Title & Labels

**Title:** `DGX Spark (GB10) Provider Support — Hardware Security, Attestation, and Clustering`

**Labels:** `provider-hardening`, `linux`, `nvidia`, `hardware-attestation`, `architecture`

**Milestone:** Post-alpha (depends on DGX Spark availability)

**Priority:** P1 — DGX Spark is the first consumer-priced hardware that
could achieve L3 with GPU acceleration. It directly competes with the
Apple Silicon provider story and expands the provider base to
Linux/NVIDIA users.

---

## References

- [NVIDIA DGX Spark product page](https://www.nvidia.com/en-us/products/personal-ai/dgx-spark/)
- [NVIDIA Confidential Computing](https://developer.nvidia.com/confidential-computing)
- [ARM Confidential Compute Architecture (CCA)](https://www.arm.com/architecture/security-features/arm-confidential-compute-architecture)
- [TCG TPM 2.0 Specification](https://trustedcomputinggroup.org/resource/tpm-library-specification/)
- [NVIDIA Attestation SDK](https://docs.nvidia.com/attestation/)
- [Linux Kernel Lockdown](https://man7.org/linux/man-pages/man7/kernel_lockdown.7.html)
- [dm-verity](https://www.kernel.org/doc/html/latest/admin-guide/device-mapper/verity.html)
- [seccomp-BPF](https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html)
