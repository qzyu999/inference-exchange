# Windows Hardened Provider — Implementation Plan

## Goal

Build a hardened inference provider for Windows that achieves the highest
practical isolation level given the hardware available. Three tiers depending
on hardware:

- **Tier A: Hyper-V + GPU-P** — hypervisor isolation with GPU access (~Level 2)
- **Tier B: AMD SEV-SNP** — hardware-encrypted memory, CPU only (Level 3)
- **Tier C: Process mitigations only** — blocks casual observation (Level 1.5)

## Platform Comparison

| Property | macOS (Apple Silicon) | Windows (this doc) |
|---|---|---|
| Best achievable without VM | Level 2 (kernel exploit required) | Level 1.5 (admin with tools can bypass) |
| Mechanism | PT_DENY_ATTACH + Hardened Runtime + SIP | SetProcessMitigationPolicy (weaker) |
| Why stronger/weaker | macOS kernel permanently refuses memory access | Windows has no equivalent permanent protection |
| Best achievable with VM | N/A (no GPU passthrough to VMs) | Level 2 (Hyper-V + GPU-P) or Level 3 (SEV-SNP, no GPU) |
| GPU in VM | ❌ Not possible | ✅ GPU-P (shared) or DDA (exclusive, Server only) |

## Tier A: Hyper-V + GPU-P (Recommended for NVIDIA Windows Providers)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Windows (operator has admin)                                  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Hyper-V Hypervisor (runs below the Windows kernel)           │  │
│  │                                                               │  │
│  │  ┌────────────────────────────────┐                          │  │
│  │  │  Guest VM (Linux)              │                          │  │
│  │  │                                │                          │  │
│  │  │  ┌─────────────────────────┐  │                          │  │
│  │  │  │ OCIP Inference Server    │  │                          │  │
│  │  │  │ (llama.cpp + CUDA)       │  │                          │  │
│  │  │  │                          │  │                          │  │
│  │  │  │ • Full CUDA access       │  │  ← GPU-P: virtual GPU   │  │
│  │  │  │ • Runs inference         │  │    backed by physical    │  │
│  │  │  │ • Memory isolated by HV  │  │    NVIDIA card           │  │
│  │  │  │ • Listens on vsock/TCP   │  │                          │  │
│  │  │  └─────────────────────────┘  │                          │  │
│  │  └────────────────────────────────┘                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────┐                                      │
│  │  OCIP Agent (host)        │                                      │
│  │  • WebSocket to coord     │                                      │
│  │  • E2E decryption         │                                      │
│  │  • Forwards to VM guest   │                                      │
│  └──────────────────────────┘                                      │
│                                                                     │
│  Operator can:                                                      │
│  ✗ Read guest VM CPU memory (hypervisor blocks)                    │
│  ⚠ Potentially observe GPU buffers (shared driver)                 │
│  ✗ Attach debugger to guest process (different OS boundary)        │
│  ✗ Use Process Hacker on guest (host tools don't reach guest)      │
│                                                                     │
│  To break: hypervisor escape exploit (~$250k-$500k)                │
│  GPU caveat: shared GPU driver is a theoretical vector             │
└────────────────────────────────────────────────────────────────────┘
```

### Requirements

- Windows 10/11 Pro or Enterprise (Hyper-V requires Pro+)
- NVIDIA GPU with CUDA support
- Hyper-V enabled (`Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All`)
- GPU-P configured (Windows 11 22H2+ supports this natively for Linux VMs)

### Setup Steps

```powershell
# 1. Enable Hyper-V
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All

# 2. Create a Linux VM with GPU-P
# (GPU-PV is automatically available in WSL2 VMs and Hyper-V Quick Create Linux VMs)

# 3. Inside the VM: install CUDA + llama.cpp
sudo apt update && sudo apt install -y cmake build-essential
git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp
cmake -B build -DGGML_CUDA=ON && cmake --build build --target llama-server -j

# 4. Inside the VM: start inference server (localhost only inside VM)
./build/bin/llama-server --model /models/llama-3-8b-Q4_K_M.gguf --host 127.0.0.1 --port 9999

# 5. On host: configure port forwarding (VM vsock or NAT)
# The OCIP agent on the host connects to the VM's internal address

# 6. On host: start OCIP agent
python ocip_agent/agent.py --inference-server http://<vm-ip>:9999 --name "hyper-v-gpu-node"
```

### Security Analysis

| Attack | Blocked? | Mechanism |
|--------|----------|-----------|
| Process Hacker / debugger on host | ✅ | Target runs in different OS (guest VM) |
| ReadProcessMemory from host | ✅ | Hypervisor page table isolation |
| Network sniffing (host tcpdump) | ⚠️ | Can see VM↔host traffic — use encrypted vsock |
| Kernel driver on host reading VM memory | ✅ | Hyper-V second-level address translation (SLAT) |
| Hyper-V escape exploit | ❌ | This is the residual risk (~$250k+ exploit) |
| GPU memory observation via driver | ⚠️ | Shared GPU-P driver on host has visibility |

### GPU Memory Caveat

GPU-P works by sharing the GPU driver between host and guest. The host's GPU
driver *manages* the physical GPU memory. In theory, the host driver (or a
kernel module on the host) could observe GPU buffer contents.

In practice:
- NVIDIA's driver doesn't expose guest GPU memory to host userspace
- It would require a custom kernel driver on the host targeting GPU memory
- This is significantly harder than just reading process memory
- For most threat models (opportunistic provider, not state actor), this is adequate

For absolute GPU memory protection, you need NVIDIA Confidential Computing (H100+) —
which is not available on consumer hardware.

### OCIP Confidence Level: Level 2 (HARDENED)

This setup qualifies as Level 2 because:
- CPU memory is hypervisor-isolated (escape required to observe)
- The attack bar is "hypervisor escape" (~$250k+ exploit)
- GPU memory has a theoretical but impractical leak path

---

## Tier B: AMD SEV-SNP Confidential VM (Level 3, No GPU)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Windows (operator has admin, physical access)                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  AMD Secure Processor encrypts VM memory with unique key      │  │
│  │                                                               │  │
│  │  ┌────────────────────────────────┐                          │  │
│  │  │  Confidential VM (SEV-SNP)      │                          │  │
│  │  │                                 │                          │  │
│  │  │  ALL memory = ciphertext        │  ← Even with physical    │  │
│  │  │  to the host                    │    RAM access, host sees  │  │
│  │  │                                 │    only encrypted bytes   │  │
│  │  │  OCIP Inference Server          │                          │  │
│  │  │  (llama.cpp, CPU-only)          │                          │  │
│  │  │  • Inference on CPU (no GPU)    │                          │  │
│  │  │  • ~20-30 tok/s for 7B on       │                          │  │
│  │  │    modern AMD (AVX-512)         │                          │  │
│  │  └────────────────────────────────┘                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Operator can:                                                      │
│  ✗ Read VM memory (hardware encrypted)                             │
│  ✗ Attach debugger (different OS + encrypted memory)               │
│  ✗ Physical RAM probing (encrypted)                                │
│  ✗ Cold boot attack (encrypted)                                    │
│                                                                     │
│  To break: AMD Secure Processor hardware vulnerability             │
│  (no known exploits in the wild, theoretical research only)        │
└────────────────────────────────────────────────────────────────────┘
```

### Requirements

- AMD EPYC 7003+ (server) or Ryzen Pro 6000+ (consumer/laptop)
- Windows Server 2025 with Hyper-V (or Linux KVM for more flexibility)
- SEV-SNP enabled in BIOS
- Confidential VM support in hypervisor

### Setup Steps

```powershell
# On Linux host (easier than Windows for SEV-SNP):
# 1. Enable SEV-SNP in BIOS (AMD CBS → CPU Configuration → SEV-SNP)
# 2. Install QEMU with SEV support
sudo apt install qemu-kvm qemu-utils ovmf

# 3. Launch confidential VM
qemu-system-x86_64 \
    -machine q35,confidential-guest-support=sev0 \
    -object sev-snp-guest,id=sev0,cbitpos=51,reduced-phys-bits=1 \
    -m 32G -smp 16 \
    -drive file=inference-vm.qcow2,format=qcow2 \
    ...

# 4. Inside CVM: run llama.cpp (CPU-only, no GPU in SEV VMs yet)
./llama-server --model /models/llama-3-8b-Q4_K_M.gguf --host 0.0.0.0 --port 9999

# 5. On host: OCIP agent connects to CVM
python ocip_agent/agent.py --inference-server http://<cvm-ip>:9999 --trust confidential
```

### Security Analysis

| Attack | Blocked? | Mechanism |
|--------|----------|-----------|
| Host kernel memory read | ✅ | Hardware AES encryption (AMD SME) |
| Physical RAM probing | ✅ | RAM contents are ciphertext |
| Cold boot attack | ✅ | Memory encrypted at rest |
| DMA attack (Thunderbolt/PCIe) | ✅ | IOMMU + encrypted memory |
| Hypervisor reading guest memory | ✅ | SEV-SNP integrity checks block this |
| AMD Secure Processor vulnerability | ❌ | Residual risk (no known exploits) |

### Performance

CPU-only inference (no GPU access from SEV-SNP VMs):
- Ryzen 9 7950X: ~25-30 tok/s for 7B Q4_K_M (AVX-512)
- EPYC 7763: ~35-45 tok/s for 7B Q4_K_M (many cores)
- Overhead from SEV encryption: ~2-5% (negligible)

### OCIP Confidence Level: Level 3 (CONFIDENTIAL)

This is the strongest available protection. Memory is hardware-encrypted.
The tradeoff: no GPU acceleration (slower inference).

---

## Tier C: Process Mitigations Only (Weakest, No VM)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Windows (operator has admin)                                  │
│                                                                     │
│  ┌──────────────────────────────────┐                              │
│  │  OCIP Inference Server            │                              │
│  │  (llama.cpp compiled with         │                              │
│  │   hardening_windows.c)            │                              │
│  │                                   │                              │
│  │  Mitigations applied:            │                              │
│  │  • ProcessDynamicCodePolicy       │  (blocks DLL injection)      │
│  │  • ProcessSignaturePolicy         │  (MS-signed DLLs only)       │
│  │  • ProcessImageLoadPolicy         │  (no remote images)          │
│  │  • ProcessExtensionPointDisable   │  (no AppInit_DLLs)           │
│  │                                   │                              │
│  │  Full GPU access (CUDA/DirectML)  │                              │
│  └──────────────────────────────────┘                              │
│                                                                     │
│  Operator can:                                                      │
│  ✗ Inject DLLs (blocked by policy)                                 │
│  ✗ Use AppInit_DLLs (blocked)                                      │
│  ✅ Use Process Hacker to read memory (NOT blocked)                 │
│  ✅ Use WinDbg kernel debugger (NOT blocked)                        │
│  ✅ ReadProcessMemory as admin (NOT blocked)                        │
│                                                                     │
│  To break: just be admin with the right tools                      │
│  This is NOT "kernel exploit required"                             │
└────────────────────────────────────────────────────────────────────┘
```

### Security Analysis

| Attack | Blocked? | Mechanism |
|--------|----------|-----------|
| DLL injection (most malware) | ✅ | ProcessDynamicCodePolicy |
| AppInit_DLLs | ✅ | ProcessExtensionPointDisablePolicy |
| Casual observation (Task Manager) | ✅ | Process doesn't show plaintext in UI |
| Process Hacker / memory dump | ❌ | Admin can always ReadProcessMemory |
| WinDbg kernel debugging | ❌ | Admin can enable kernel debugger |
| Custom usermode tool | ❌ | OpenProcess(PROCESS_VM_READ) works for admin |

### OCIP Confidence Level: Level 1 (CONTAINED) to Level 1.5

This stops casual/automated attacks but NOT a determined operator with admin tools.
Suitable for providers where the trust model is economic (reputation-based)
rather than cryptographic.

---

## Recommendation by Provider Hardware

| Provider's Hardware | Best Path | Level | GPU Speed? |
|---|---|---|---|
| Windows + NVIDIA GPU | Tier A (Hyper-V + GPU-P) | Level 2 | ~80% of native |
| Windows + AMD Ryzen Pro (SEV) | Tier B (SEV-SNP, CPU-only) | Level 3 | ❌ CPU only |
| Windows + NVIDIA GPU + AMD SEV | Both: SEV for Level 3 requests, GPU-P for Level 2 | Level 2-3 | Depends on request |
| Windows + any GPU (no Hyper-V Pro) | Tier C (mitigations only) | Level 1.5 | ✅ Full |
| Linux + NVIDIA GPU | KVM + VFIO passthrough | Level 2 | ✅ Full |
| Linux + AMD GPU + SEV-SNP | SEV-SNP + CPU inference | Level 3 | ❌ CPU only |
| macOS Apple Silicon | Hardened Runtime | Level 2 | ✅ Full Metal |

## Summary: Windows vs macOS for Level 2

| | macOS | Windows |
|---|---|---|
| Easiest path to Level 2 | Hardened Runtime (5 lines of C + codesign) | Hyper-V VM + GPU-P (OS feature) |
| GPU access at Level 2 | ✅ Full Metal (same process) | ✅ ~80% via GPU-P (VM overhead) |
| Complexity | Low (compile + sign) | Medium (VM provisioning) |
| Residual risk at Level 2 | Kernel exploit | Hypervisor escape + GPU driver |
| Path to Level 3 | ❌ Not possible | ✅ AMD SEV-SNP (but loses GPU) |
