# Linux Hardened Provider — Implementation Plan

## Goal

Build a hardened inference provider on Linux that achieves the highest practical
isolation. Linux offers the most flexible path to strong security — it's the only
consumer platform where you can get Level 3 (hardware-encrypted) WITH full GPU speed
via VFIO passthrough.

## Tiers Available on Linux

| Tier | Mechanism | GPU? | Security Level | Effort |
|------|-----------|------|---------------|--------|
| A | KVM + VFIO GPU passthrough | ✅ Full (exclusive) | Level 2 (hypervisor) | Medium |
| B | AMD SEV-SNP confidential VM | ❌ CPU only | Level 3 (hardware encrypted) | Medium |
| C | AMD SEV-SNP + VFIO (future) | ✅ Full (when supported) | Level 3 (hardware) | Not yet available |
| D | Firecracker microVM (no GPU) | ❌ CPU only | Level 2 (hypervisor) | Low |
| E | Container + seccomp (no isolation from root) | ✅ Full | Level 1 (container) | Trivial |
| F | Process hardening (kernel lockdown) | ✅ Full | Level 1.5 (weaker than macOS) | Low |

## Tier A: KVM + VFIO GPU Passthrough (Best GPU + Strong Security)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Linux (operator has root)                                     │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  KVM Hypervisor (built into Linux kernel)                     │  │
│  │                                                               │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Guest VM (minimal Linux)                               │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌──────────────────────────────────────────────────┐  │  │  │
│  │  │  │  OCIP Inference Server                            │  │  │  │
│  │  │  │  (llama.cpp with CUDA)                            │  │  │  │
│  │  │  │                                                   │  │  │  │
│  │  │  │  • NVIDIA GPU passed through via VFIO-PCI        │  │  │  │
│  │  │  │  • GPU is EXCLUSIVELY owned by the VM            │  │  │  │
│  │  │  │  • Host cannot see GPU memory (IOMMU enforced)   │  │  │  │
│  │  │  │  • Full CUDA performance (no overhead)           │  │  │  │
│  │  │  │  • VM memory isolated by hardware page tables    │  │  │  │
│  │  │  └──────────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────┐                                      │
│  │  OCIP Agent (host)        │                                      │
│  │  • WebSocket to coord     │                                      │
│  │  • E2E decryption         │                                      │
│  │  • Forwards to VM via     │                                      │
│  │    virtio-vsock            │                                      │
│  └──────────────────────────┘                                      │
│                                                                     │
│  Operator can:                                                      │
│  ✗ Read VM CPU memory (KVM SLAT page tables)                       │
│  ✗ Access GPU memory (IOMMU assigns device exclusively to VM)      │
│  ✗ Sniff vsock traffic (kernel-mediated, not network)              │
│  ✗ Attach debugger to guest (different kernel)                     │
│                                                                     │
│  To break: KVM hypervisor escape (~$250k-$500k exploit)            │
└────────────────────────────────────────────────────────────────────┘
```

### Why Linux + VFIO Is The Best Option for GPU Inference

Unlike Windows GPU-P (which shares the GPU driver between host and guest), VFIO
gives the GPU **entirely** to the VM. The host driver unbinds, IOMMU remaps all
DMA to the guest, and the host literally cannot access GPU memory. This is the
strongest GPU isolation available without confidential computing hardware.

Performance is essentially native — the guest talks directly to GPU hardware
through the IOMMU. No paravirtualization overhead.

### Requirements

- Linux host (Ubuntu 22.04+, Fedora 38+, Arch)
- NVIDIA GPU (discrete, not integrated)
- Second GPU or headless server (host loses the passed-through GPU)
- CPU with IOMMU support (Intel VT-d or AMD-Vi — standard on all modern CPUs)
- IOMMU groups that allow isolating the GPU

### Setup Steps

```bash
# 1. Enable IOMMU in kernel boot parameters
# For AMD: amd_iommu=on iommu=pt
# For Intel: intel_iommu=on iommu=pt
sudo vim /etc/default/grub
# Add to GRUB_CMDLINE_LINUX: "amd_iommu=on iommu=pt"
sudo update-grub && sudo reboot

# 2. Identify GPU PCI address and IOMMU group
lspci -nn | grep -i nvidia
# e.g. 01:00.0 VGA compatible controller [0300]: NVIDIA Corporation... [10de:2684]

# 3. Bind GPU to vfio-pci driver (detach from host nvidia driver)
echo "10de 2684" | sudo tee /sys/bus/pci/drivers/vfio-pci/new_id
# Or configure via /etc/modprobe.d/vfio.conf for boot-time binding

# 4. Create VM with GPU passthrough
sudo qemu-system-x86_64 \
    -enable-kvm \
    -m 32G \
    -smp 16 \
    -cpu host \
    -device vfio-pci,host=01:00.0 \
    -device vhost-vsock-pci,guest-cid=3 \
    -drive file=inference-vm.qcow2,format=qcow2 \
    -net nic -net user,hostfwd=tcp::9999-:9999

# 5. Inside VM: install NVIDIA drivers + CUDA + llama.cpp
sudo apt install nvidia-driver-535 nvidia-cuda-toolkit
git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp
cmake -B build -DGGML_CUDA=ON && cmake --build build -j

# 6. Inside VM: start inference server
./build/bin/llama-server \
    --model /models/llama-3-8b-Q4_K_M.gguf \
    --host 0.0.0.0 --port 9999 \
    --n-gpu-layers -1

# 7. On host: start OCIP agent
python ocip_agent/agent.py \
    --inference-server http://localhost:9999 \
    --name "linux-vfio-gpu-node" \
    --trust hardened
```

### Security Analysis

| Attack | Blocked? | Mechanism |
|--------|----------|-----------|
| Read VM memory from host userspace | ✅ | KVM EPT/NPT page tables |
| Access GPU memory from host | ✅ | IOMMU assigns GPU exclusively to VM |
| DMA attack from other PCIe devices | ✅ | IOMMU isolation per device |
| Network sniff host↔VM | ⚠️ | Use vsock (kernel-mediated), not TCP |
| Kernel module on host reading VM memory | ✅ | KVM doesn't expose guest physical memory |
| KVM/QEMU exploit | ❌ | Residual risk (hypervisor escape) |

### OCIP Confidence Level: Level 2 (HARDENED)

Hypervisor escape required. GPU memory is IOMMU-isolated (not shared with host).
This is **stronger than Windows GPU-P** because the GPU is exclusively owned by
the guest, not shared via a host driver.

---

## Tier B: AMD SEV-SNP Confidential VM (Level 3, CPU Only)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Linux (operator has root + physical access)                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  KVM + AMD SEV-SNP                                            │  │
│  │                                                               │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Confidential VM                                        │  │  │
│  │  │                                                         │  │  │
│  │  │  Memory state: AES-256 encrypted by AMD SP              │  │  │
│  │  │  Host sees: ciphertext only                             │  │  │
│  │  │                                                         │  │  │
│  │  │  OCIP Inference Server (llama.cpp, CPU-only)            │  │  │
│  │  │  • ~30-45 tok/s for 7B on EPYC                         │  │  │
│  │  │  • ~20-28 tok/s for 7B on Ryzen Pro                    │  │  │
│  │  │  • ~2-5% overhead from encryption (negligible)          │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Operator can:                                                      │
│  ✗ Read VM memory (AES encrypted)                                  │
│  ✗ Physical RAM probe (encrypted at hardware level)                │
│  ✗ Cold boot attack (memory is ciphertext)                         │
│  ✗ DMA attack (encrypted + IOMMU)                                  │
│  ✗ Modify VM memory undetected (integrity protection)              │
│                                                                     │
│  To break: AMD Secure Processor hardware vulnerability             │
│  (no practical exploits known)                                      │
└────────────────────────────────────────────────────────────────────┘
```

### Requirements

- AMD EPYC 7003+ (server) or AMD Ryzen Pro 6000+ (consumer laptop/desktop)
- Linux kernel 5.19+ (SEV-SNP support)
- QEMU 7.2+ (SEV-SNP guest support)
- OVMF firmware (SEV-capable)
- SEV-SNP enabled in BIOS (AMD CBS settings)

### Setup Steps

```bash
# 1. Enable SEV-SNP in BIOS
# AMD CBS → CPU Configuration → SEV-SNP → Enabled
# AMD CBS → NBIO → IOMMU → Enabled

# 2. Verify kernel support
dmesg | grep -i sev
# Should show: "SEV-SNP supported" and "SEV-SNP API:x.xx"

cat /sys/module/kvm_amd/parameters/sev_snp
# Should show: Y

# 3. Install QEMU with SEV support
sudo apt install qemu-kvm ovmf

# 4. Launch confidential VM
qemu-system-x86_64 \
    -enable-kvm \
    -machine q35,confidential-guest-support=sev0,vmport=off \
    -object sev-snp-guest,id=sev0,cbitpos=51,reduced-phys-bits=1,policy=0x30000 \
    -cpu EPYC-v4 \
    -m 32G -smp 16 \
    -bios /usr/share/OVMF/OVMF_CODE.fd \
    -drive file=inference-cvm.qcow2,format=qcow2,if=none,id=disk0 \
    -device virtio-blk-pci,drive=disk0 \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0,hostfwd=tcp::9999-:9999 \
    -device vhost-vsock-pci,guest-cid=3

# 5. Inside CVM: verify SEV is active
dmesg | grep -i sev
# "AMD Memory Encryption Features active: SEV SEV-ES SEV-SNP"

# 6. Inside CVM: run inference (CPU-only)
./llama-server --model /models/llama-3-8b-Q4_K_M.gguf \
    --host 0.0.0.0 --port 9999 --n-gpu-layers 0

# 7. On host: OCIP agent
python ocip_agent/agent.py \
    --inference-server http://localhost:9999 \
    --name "linux-sev-snp-node" \
    --trust confidential
```

### Remote Attestation

SEV-SNP provides hardware-signed attestation reports:

```bash
# Inside the CVM: get attestation report
# (includes measurement of VM launch state + 64 bytes of user data)
sevctl report --request-file report.bin --data "$(echo -n $OCIP_PUBLIC_KEY | sha256sum)"

# The report is signed by the AMD Secure Processor
# Verifier (coordinator) checks against AMD's published ARK/ASK certificates
```

The coordinator can verify:
- The VM is genuinely running under SEV-SNP (not a fake)
- The VM launched with a specific disk image (measurement hash)
- The provider's public key is bound to the hardware attestation

### OCIP Confidence Level: Level 3 (CONFIDENTIAL)

Hardware-encrypted memory. Mathematically impossible to observe without
breaking AES-256 or finding an AMD Secure Processor vulnerability.

---

## Tier D: Firecracker MicroVM (Level 2, No GPU, Minimal Attack Surface)

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host Linux                                                         │
│                                                                     │
│  ┌────────────────────────────────────────────────────────┐        │
│  │  Firecracker (Amazon's microVM hypervisor)              │        │
│  │  • ~50k lines of Rust code (tiny attack surface)        │        │
│  │  • No USB, no display, no PCI — just CPU + RAM + net    │        │
│  │  • Boot in <125ms                                       │        │
│  │                                                         │        │
│  │  ┌──────────────────────────────────────────────────┐  │        │
│  │  │  Guest (minimal Linux)                            │  │        │
│  │  │  • llama.cpp (CPU-only)                           │  │        │
│  │  │  • ~15-30 tok/s for 7B                            │  │        │
│  │  │  • Communication via vsock                        │  │        │
│  │  └──────────────────────────────────────────────────┘  │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                     │
│  Why Firecracker:                                                   │
│  • Smallest hypervisor attack surface (vs QEMU's millions of LOC)  │
│  • Zero known escapes since 2018 (powers AWS Lambda)               │
│  • Boot + inference in seconds                                      │
│  • Perfect for: CPU inference where speed matters less than security│
└────────────────────────────────────────────────────────────────────┘
```

### Setup Steps

```bash
# 1. Download Firecracker
curl -L https://github.com/firecracker-microvm/firecracker/releases/download/v1.7.0/firecracker-v1.7.0-x86_64.tgz | tar xz

# 2. Prepare rootfs with llama.cpp baked in
# (Use docker export to create a filesystem image)
docker run --rm -it ubuntu:22.04 bash -c "
    apt update && apt install -y cmake build-essential wget
    git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp
    cmake -B build && cmake --build build --target llama-server -j
"
# Export as ext4 image for Firecracker

# 3. Start Firecracker VM
./firecracker --api-sock /tmp/firecracker.socket
# Configure via API: set kernel, rootfs, vcpu, memory, vsock

# 4. Inside VM: run inference
/llama.cpp/build/bin/llama-server --model /models/model.gguf --host 0.0.0.0 --port 9999

# 5. On host: OCIP agent connects via vsock
python ocip_agent/agent.py --inference-server vsock://3:9999 --trust hardened
```

### OCIP Confidence Level: Level 2 (HARDENED)

Smallest possible attack surface. Zero known escapes. But no GPU access.

---

## Tier E: Container + Seccomp (Level 1)

```bash
# Simple Docker-based isolation
docker run --rm \
    --security-opt no-new-privileges \
    --security-opt seccomp=hardened.json \
    --cap-drop ALL \
    --read-only \
    --network none \
    --gpus all \
    ocip-inference:latest \
    --model /models/model.gguf --port 9999
```

Has GPU access (`--gpus all`). Host root can trivially read container memory
via `/proc/<pid>/mem`. Only blocks accidental leakage and unprivileged access.

### OCIP Confidence Level: Level 1 (CONTAINED)

---

## Summary: Linux Paths Ranked

| Path | GPU? | Security | Complexity | Best For |
|------|------|----------|------------|----------|
| **KVM + VFIO** | ✅ Full native | Level 2 (hypervisor escape) | Medium | Dedicated GPU providers |
| **SEV-SNP** | ❌ CPU only | Level 3 (hardware) | Medium | High-security requests |
| **Firecracker** | ❌ CPU only | Level 2 (tiny attack surface) | Low | Fast-boot ephemeral inference |
| **Docker + seccomp** | ✅ Full | Level 1 (container) | Trivial | Low-sensitivity workloads |
| **Process hardening** | ✅ Full | Level 1.5 (weak) | Low | Basic protection |

## Linux vs macOS vs Windows

| | Linux | macOS | Windows |
|---|---|---|---|
| Best Level 2 with GPU | ✅ KVM+VFIO (full GPU, IOMMU isolated) | ✅ Hardened Runtime (full Metal) | ⚠️ Hyper-V GPU-P (shared driver) |
| Level 3 available? | ✅ AMD SEV-SNP | ❌ | ✅ AMD SEV-SNP |
| GPU at Level 3? | ❌ (today) / ✅ (future with CoCo GPU) | ❌ | ❌ |
| Easiest to set up | Docker (Level 1) | Codesign (Level 2) | Mitigations (Level 1.5) |
| Strongest available | SEV-SNP (Level 3) | Hardened Runtime (Level 2) | SEV-SNP (Level 3) |
| Best for providers | Dedicated GPU servers | Personal Macs | Gaming PCs (Hyper-V) |

## Why Linux Is The Best Platform for Serious Providers

1. **VFIO gives true GPU isolation** — the GPU is exclusively owned by the VM, host can't access GPU memory at all. Windows GPU-P shares the driver (weaker). macOS can't pass GPU to VMs at all.

2. **SEV-SNP is most mature on Linux** — first-class KVM support, well-documented, production-deployed at scale (Azure, GCP).

3. **Firecracker for lightweight isolation** — boots in 125ms, zero known escapes, purpose-built for multi-tenant compute (powers AWS Lambda/Fargate).

4. **Flexibility** — can run multiple tiers simultaneously. Level 1 containers for cheap requests, VFIO VMs for premium, SEV-SNP for confidential.

5. **No vendor dependencies** — no Apple Developer account, no Microsoft signing, no proprietary tools. All open source.
