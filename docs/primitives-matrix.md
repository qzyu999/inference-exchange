# Inference Exchange -- Complete Primitives Matrix

A rigorous enumeration of every variable in the system, their interactions,
and what our framework can guarantee vs what it cannot.

## 1. The Primitives

### 1.1 Models

**Base models** (the weights trained by a lab):

| Family | Creator | Sizes | License | Notes |
|---|---|---|---|---|
| Llama 3.x | Meta | 1B, 3B, 8B, 70B, 405B | Llama license | Most popular open model |
| Qwen 2.5 | Alibaba | 0.5B, 1.5B, 3B, 7B, 14B, 32B, 72B | Apache 2.0 | Strong multilingual |
| Mistral | Mistral AI | 7B, 8x7B (MoE), 8x22B | Apache 2.0 | MoE architecture |
| Gemma 2 | Google | 2B, 9B, 27B | Gemma license | Compact, efficient |
| Phi 3/4 | Microsoft | 3.8B, 14B | MIT | Small but capable |
| DeepSeek V2/V3 | DeepSeek | 16B, 236B (MoE) | MIT | Strong code/math |
| Command-R | Cohere | 35B, 104B | CC-BY-NC | RAG-optimized |
| Yi | 01.AI | 6B, 9B, 34B | Apache 2.0 | |

**Variants** (post-training modifications):

| Variant | What it means | Effect |
|---|---|---|
| Base | Raw pretrained weights | Completion only, no chat |
| Instruct | Fine-tuned for instructions | Chat-capable |
| Chat | Fine-tuned for conversation | Multi-turn optimized |
| Code | Fine-tuned on code | Better at programming |
| Math | Fine-tuned on math | Better reasoning |
| Vision | Multimodal (text + image) | Can process images |
| RLHF/DPO | Alignment-tuned | Safer, more helpful |

### 1.2 Model Formats

| Format | Extension | Metadata | Quantization | Used by |
|---|---|---|---|---|
| GGUF | .gguf | Rich (name, arch, quant, ctx) | Built-in (Q2-Q8, F16, F32) | llama.cpp, ollama |
| SafeTensors | .safetensors | None in file (needs config.json) | Separate (AWQ, GPTQ, or none) | vLLM, TGI, MLX, transformers |
| PyTorch | .bin, .pt | None in file | None (FP16/FP32 only) | transformers (legacy) |
| MLX | .npz, .safetensors | Via config.json | MLX-native (4bit, 8bit) | MLX only |
| ONNX | .onnx | In model proto | Various | ONNX Runtime |
| TensorRT | .engine | None | INT8, FP16 | TensorRT (NVIDIA only) |

**Key insight:** Only GGUF embeds model identity in the weight file itself.
All other formats rely on accompanying files (config.json, tokenizer.json)
or the directory/repo structure for identity.

### 1.3 Quantization

Quantization reduces model size and increases speed at the cost of quality.

**GGUF quantization types:**

| Type | Bits/weight | Size factor | Quality | Speed |
|---|---|---|---|---|
| F32 | 32 | 1.0x | Perfect | Slowest |
| F16 | 16 | 0.5x | Near-perfect | Slow |
| Q8_0 | 8 | 0.25x | Very good | Medium |
| Q6_K | 6.6 | ~0.20x | Good | Medium-fast |
| Q5_K_M | 5.5 | ~0.17x | Good | Fast |
| Q4_K_M | 4.5 | ~0.14x | Acceptable | Fast |
| Q4_0 | 4 | ~0.13x | Acceptable | Fastest |
| Q3_K_M | 3.4 | ~0.11x | Degraded | Fastest |
| Q2_K | 2.6 | ~0.08x | Poor | Fastest |

**Non-GGUF quantization:**

| Method | Format | Bits | Applied by |
|---|---|---|---|
| AWQ | SafeTensors | 4 | Pre-quantized on HF |
| GPTQ | SafeTensors | 4, 8 | Pre-quantized on HF |
| MLX quantize | SafeTensors/npz | 4, 8 | mlx-lm CLI |
| bitsandbytes | Runtime | 4, 8 | transformers (runtime) |
| None (FP16) | SafeTensors | 16 | Original upload |

### 1.4 Inference Engines

| Engine | Language | Platforms | Formats | GPU | API | Hardening |
|---|---|---|---|---|---|---|
| llama.cpp | C++ | All | GGUF | Metal, CUDA, ROCm, Vulkan | /v1/chat/completions | Yes (compiled C, PT_DENY_ATTACH) |
| MLX / mlx-lm | Python+C++ | macOS only | SafeTensors | Metal (native) | /v1/chat/completions | Yes (PyInstaller + PT_DENY_ATTACH via ctypes) |
| Ollama (stock) | Go + C++ | All | GGUF (internal) | Metal, CUDA | /v1/chat/completions | No (pre-built binary) |
| Ollama (from source) | Go + C++ | All | GGUF (internal) | Metal, CUDA | /v1/chat/completions | Yes (same C patch as llama.cpp) |
| vLLM | Python + CUDA | Linux | SafeTensors | CUDA only | /v1/chat/completions | Yes (inside SEV-SNP VM) |
| TGI | Rust + Python | Linux | SafeTensors | CUDA | /v1/chat/completions (compat) | Yes (inside VM) |
| TabbyAPI | Python | Linux, Windows | GGUF, EXL2 | CUDA, ROCm | /v1/chat/completions | Partial |
| transformers | Python | All | All | CUDA, Metal (partial) | No standard API | No |

**Key insight:** Every major engine speaks `/v1/chat/completions`. This is our
integration point. We don't need to know the engine internals -- we just need
the API contract.

### 1.5 Hardware Platforms

| Platform | GPU | Memory model | Hardening approach |
|---|---|---|---|
| macOS + Apple Silicon | Metal (unified memory) | Shared CPU/GPU | PT_DENY_ATTACH + Hardened Runtime |
| Linux + NVIDIA | CUDA (discrete GPU) | Separate VRAM | SEV-SNP VM or KVM+VFIO |
| Linux + AMD | ROCm (discrete GPU) | Separate VRAM | SEV-SNP VM |
| Windows + NVIDIA | CUDA | Separate VRAM | Hyper-V VM + GPU-P |
| Windows + AMD | ROCm (limited) | Separate VRAM | Hyper-V VM |
| Linux + Intel | SYCL (discrete/integrated) | Varies | TDX VM |

### 1.6 Model Sources

Where providers get their models:

| Source | Format | Identity verification | Download method |
|---|---|---|---|
| HuggingFace (GGUF repos) | GGUF | SHA-256 hash published per file | huggingface-hub CLI, wget |
| HuggingFace (SafeTensors repos) | SafeTensors | SHA-256 hash published per file | huggingface-hub CLI |
| Ollama library | GGUF (internal) | Ollama digest (SHA-256) | `ollama pull` |
| MLX Community (HF) | MLX SafeTensors | SHA-256 hash on HF | mlx-lm CLI, huggingface-hub |
| Direct download (URL) | Any | Provider's responsibility | wget, curl |
| Self-quantized | Any | Not verifiable against HF | Provider creates locally |

## 2. The Interaction Matrix

### 2.1 What can we verify vs what we trust?

| Property | GGUF + llama.cpp | SafeTensors + MLX | SafeTensors + vLLM | Ollama (from source) | Self-quantized |
|---|---|---|---|---|---|
| Model name | VERIFY (GGUF header) | VERIFY (config.json, hash-bound) | VERIFY (config.json, hash-bound) | VERIFY (GGUF header in blob) | TRUST (provider claims) |
| Architecture | VERIFY (GGUF header) | VERIFY (config.json) | VERIFY (config.json) | VERIFY (GGUF header) | TRUST |
| Quantization | VERIFY (GGUF file_type) | VERIFY (config.json) | VERIFY (config.json) | VERIFY (GGUF file_type) | TRUST |
| Context length | VERIFY (GGUF header) | VERIFY (config.json) | VERIFY (config.json) | VERIFY (GGUF header) | TRUST |
| File integrity | VERIFY (SHA-256 vs HF) | VERIFY (all-file SHA-256 vs HF) | VERIFY (all-file SHA-256 vs HF) | VERIFY (blob filename = SHA-256) | UNVERIFIABLE |
| Model quality | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE |

**Key insight:** GGUF is the only format where model identity is embedded IN
the weight file itself. SafeTensors/MLX formats rely on config.json which is
a separate file -- but when ALL files (weights + config) are hash-verified
against HuggingFace, the identity is equally trustworthy because the config
can't be forged without breaking the hash chain.

### 2.2 What can we guarantee at each OCIP level?

| Guarantee | L0 Open | L1 Contained | L2 Hardened | L3 Confidential |
|---|---|---|---|---|
| Prompt encrypted in transit | No | Yes | Yes | Yes |
| Response encrypted | No | No (unless IE SDK) | Yes (IE SDK) | Yes |
| Provider can't read prompts | No | No | Yes (kernel 0-day required) | Yes (hardware TEE) |
| Provider can't read responses | No | No | Yes | Yes |
| Coordinator can't read prompts | Yes (E2E) | Yes | Yes | Yes |
| Coordinator can't read responses | No | No | Yes (IE SDK) | Yes |
| Model is what provider claims | No | SHA-256 if available | SHA-256 + hardened process | SHA-256 + TEE attestation |
| Quantization is accurate | No | Trust engine report | GGUF: verified. Others: trusted | Verified in TEE |
| Inference ran on claimed model | No | No | Can't swap (hardened binary) | TEE measurement proves it |
| Provider can't log prompts | No | No | Yes (can't attach debugger) | Yes (memory encrypted) |
| Provider can't modify responses | No | No | Yes (hardened binary) | Yes |

### 2.3 Engine x Format x Platform Matrix

Can this combination work on our exchange?

| Engine | GGUF | SafeTensors | Ollama blob | Platform | Hardening possible? | Identity source |
|---|---|---|---|---|---|---|
| llama.cpp | YES | No | Yes (is GGUF) | All | macOS: Yes. Linux: VM | GGUF header |
| MLX (standalone) | No (needs conversion) | YES | No | macOS only | PyInstaller + codesign | config.json |
| Ollama (stock binary) | YES (internal) | No | YES | All | No (pre-built, not ours) | Ollama API |
| Ollama (built from source) | YES (internal) | No | YES | All | YES (same C patch as llama.cpp) | GGUF header + Ollama digest |
| vLLM | No | YES | No | Linux + CUDA | In SEV-SNP VM | config.json |
| TGI | No | YES | No | Linux + CUDA | In VM | config.json |

## 3. What Consumers Need to Know

For a consumer to make an informed decision, they need:

| Information | Why it matters | How we get it |
|---|---|---|
| Base model + size | Determines capability | GGUF metadata / config.json / engine API |
| Variant (Instruct/Chat/Code) | Determines use case fit | Same as above |
| Quantization | Quality vs speed tradeoff | GGUF file_type / repo name / engine report |
| Context length | Max conversation length | GGUF metadata / config.json |
| Price (input + output) | Cost | Provider sets at registration |
| Speed (TPS) | Latency | Measured by coordinator |
| Trust level (L0-L3) | Privacy guarantee | Provider claim + attestation evidence |
| Engine | Affects speed and compatibility | Provider reports |
| Hardware | Affects speed | Provider reports / auto-detected |
| Model verification status | Trust in identity claims | SHA-256 vs HF, attestation |
| Provider reputation | Track record | EMA from coordinator |
| E2E encryption | Full privacy | Provider has X25519 key |

## 4. What Providers Need to Know

For a provider to price themselves competitively:

| Information | Why it matters | How we provide it |
|---|---|---|
| Competing providers' prices | Price discovery | Exchange page (transparent) |
| Reference API prices | Market positioning | OpenRouter API + major providers |
| Demand by model | What to serve | Request volume stats (future) |
| Demand by preference | How to differentiate | Preference distribution stats (future) |
| Their own performance | Efficiency | TPS tracker, reputation score |
| Hardware utilization | Capacity planning | Load factor, slot usage |

## 5. What Our Framework Can and Cannot Say

### What we CAN honestly claim:

1. "For GGUF models on hardened llama.cpp (L2), the provider cannot observe
   your prompts or responses. The model identity is cryptographically verified
   against HuggingFace. This requires a macOS kernel exploit ($500k+) to break."

2. "For any engine at L1+, your prompts are encrypted in transit. The coordinator
   never sees your data. The model identity is reported by the engine and
   verified against HuggingFace where possible."

3. "For all providers, pricing is transparent. You see exactly what each provider
   charges, their speed, their trust level, and how they compare to centralized
   APIs."

### What we CANNOT honestly claim:

1. "We guarantee the model running is exactly what the provider claims" --
   Only TRUE when file hashes are verified against HuggingFace (Paths 1-4, 6-8).
   FALSE for self-quantized models (Path 9) where no published hash exists.

2. "All providers are equally secure" -- FALSE. L0 has zero protection. L1 has
   transit encryption only. L2 has kernel-level protection but only for specific
   engine/platform combos. L3 doesn't exist yet.

3. "All engines provide identical guarantees" -- FALSE. GGUF embeds metadata
   in the weight file (strongest). SafeTensors verify metadata via separate
   config.json (verified when hashed with the weights). Stock Ollama binaries
   cannot be hardened. Self-quantized models cannot be verified.

4. "Quantization quality is verified" -- FALSE. We can verify WHAT quantization
   is used (from metadata), but not whether the quantization was done correctly.
   A bad quantization of Llama 70B could perform worse than a good Q4_K_M of 8B.

## 6. Honest Product Positioning

Given the above, the exchange should present itself as:

"A transparent marketplace for AI inference where:
- Providers compete on price, speed, and trust
- Every provider's capabilities are reported and verified where possible
- Consumers choose their privacy level (L0-L3) and accept the tradeoffs
- Model identity is verified against HuggingFace for supported formats
- All pricing data including competitor reference prices is shown honestly
- The platform takes no position on which option is 'best' -- it provides
  the information for informed decisions"

NOT as:

"A fully confidential inference platform where all providers are equally
trustworthy and all models are verified"

## 7. Implementation Priorities

Based on this analysis, what actually matters for alpha:

### Must show in UI (information transparency):
- Model name, family, size, variant
- Quantization (with caveat for non-GGUF: "reported by engine")
- Context length
- Verification status ("Verified against HuggingFace" vs "Self-reported")
- Trust level with clear explanation of what each level means
- Engine used
- Hardware
- All reference pricing (honest, including when competitors are cheaper)

### Must NOT overstate:
- SafeTensors identity is "verified" ONLY when all files are hash-checked against HF
- Stock Ollama (not built from source) should note "unhardened, L1 max"
- Ollama models from source with hash verification: "verified" is accurate
- L0/L1 trust should clearly state "provider CAN observe your data"
- Self-quantized models should note "model identity UNVERIFIED (no published hash)"

### For beta (engine-agnostic support):
- MLX engine adapter (SafeTensors + config.json identity)
- vLLM engine adapter (SafeTensors + config.json identity)
- Ollama engine adapter (manifest identity)
- Per-engine identity verification with clear confidence levels

## 8. L2+ Hardening Paths -- Every Major Permutation

For each viable engine x platform x format combination, here is the exact
path to L2 hardening AND cryptographic model verification.

The two requirements for L2+ are:
- **Hardening**: The provider operator CANNOT observe process memory (prompts, responses, keys)
- **Model verification**: The coordinator CAN prove the model files are exactly what HuggingFace published

---

### Path 1: llama.cpp + GGUF + macOS Apple Silicon

**Status: PROVEN (tested on M2 Max)**

```
Model source:  HuggingFace GGUF repo (e.g., TheBloke/Llama-3.1-8B-Instruct-GGUF)
Download:      huggingface-hub CLI or direct URL
Format:        Single .gguf file
Identity:      Embedded in GGUF header (general.name, general.architecture, general.file_type)
Verification:  SHA-256 of .gguf file vs HF published hash (one file = one hash)
Quantization:  Embedded in GGUF as file_type (Q4_K_M, Q8_0, etc.)
Context:       Embedded in GGUF ({arch}.context_length)

Hardening:
  1. Build llama-server from source with hardening.c (PT_DENY_ATTACH, RLIMIT_CORE=0, SIP check)
  2. cmake -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DOPENSSL_ROOT_DIR=/nonexistent
  3. codesign --sign - --options runtime --entitlements entitlements.plist
  4. Result: single static binary, Hardened Runtime, kernel blocks debuggers + memory reads

Verification chain:
  Agent reads GGUF header -> extracts name, arch, quant, ctx
  Agent computes SHA-256 of entire .gguf file
  Agent sends identity + hash to coordinator
  Coordinator queries HF API for file hash
  Hash match -> VERIFIED (identity is cryptographically bound to exact HF upload)

What's guaranteed:
  - Model is byte-for-byte identical to HF upload: YES
  - Model name/arch/quant from embedded metadata: YES (can't forge without changing hash)
  - Provider can't observe prompts/responses: YES (kernel 0-day required)
  - Provider can't swap model after startup: YES (binary is hardened, can't inject code)
```

### Path 2: MLX (standalone) + SafeTensors + macOS Apple Silicon

**(Same as Path 8 -- see Path 8 for full details)**

### Path 3: llama.cpp + GGUF + Linux NVIDIA (KVM + VFIO)

**Status: DESIGNED (not yet built)**

```
Model source:  HuggingFace GGUF repo
Format:        Single .gguf file
Verification:  Same as Path 1 (SHA-256 of single file)

Hardening:
  1. Build llama-server inside a minimal VM image (no SSH, no shell, read-only rootfs)
  2. VM has VFIO passthrough for the NVIDIA GPU (full GPU access, host can't intercept)
  3. llama-server listens on virtio-net socket (not TCP, invisible to host)
  4. Host cannot read VM memory (KVM memory isolation)
  5. Host cannot attach debugger to processes inside VM

What's guaranteed:
  - Model verified: YES (same GGUF hash chain)
  - Provider can't observe prompts: YES (VM memory isolation)
  - Provider can't swap model: YES (read-only rootfs in VM)
  - GPU memory protected: PARTIAL (VFIO gives VM exclusive GPU access,
    but host could theoretically read GPU BAR regions; full protection
    needs GPU TEE like NVIDIA CC)

Limitation: Host controls the hypervisor. A malicious host with kernel
access could potentially read VM memory via /dev/mem or custom KVM patches.
This is harder than userspace attacks but not impossible. True L3 requires
hardware TEE (SEV-SNP).
```

### Path 4: vLLM + SafeTensors + Linux NVIDIA (SEV-SNP)

**Status: DESIGNED (not yet built, requires AMD EPYC with SEV-SNP)**

```
Model source:  HuggingFace SafeTensors repo
Format:        Directory (same as Path 2)
Verification:  SHA-256 of every file vs HF (same as Path 2)

Hardening:
  1. vLLM runs inside AMD SEV-SNP confidential VM
  2. ALL VM memory is encrypted by the CPU hardware (AES-128)
  3. The hypervisor CANNOT read VM memory (hardware-enforced, not software)
  4. GPU memory: requires NVIDIA Confidential Computing (H100+) for full protection
  5. VM attestation: SEV-SNP produces a hardware-signed measurement of the VM

What's guaranteed:
  - Model verified: YES (hash chain)
  - Provider can't observe prompts: YES (hardware memory encryption)
  - Provider can't swap model: YES (VM measurement includes the model loader)
  - Hypervisor can't read memory: YES (hardware-enforced, this is the whole point of SEV-SNP)
  - GPU memory protected: Only with NVIDIA CC (H100 Confidential Computing mode)

This is true L3. The CPU hardware itself enforces confidentiality.
The provider has physical access to the machine but cannot read the VM's memory.
```

### Path 5: Ollama (stock binary) + GGUF + Any platform

**Status: L1 MAXIMUM (stock Ollama binary cannot be hardened)**

```
When using the pre-built Ollama binary from ollama.com:
- We did not compile it, cannot add PT_DENY_ATTACH
- Cannot codesign with Hardened Runtime (not our binary)
- The Ollama process is observable by the provider operator
- Model identity: GGUF metadata IS readable (Ollama stores standard GGUF)
- Model verification: PARTIAL (blob filename IS the SHA-256, but can't
  easily cross-reference against HF because Ollama's registry is separate)

Conclusion: Stock Ollama is L1 maximum.
```

### Path 6: Ollama (built from source, hardened) + GGUF + macOS Apple Silicon

**Status: DESIGNED (viable, Ollama is open source and buildable)**

```
Model source:  Ollama library (ollama pull llama3.1:8b) or HuggingFace via import
Download:      ollama pull (from Ollama registry) or ollama import (from GGUF file)
Format:        GGUF blobs stored as sha256-<hash> files in ~/.ollama/models/blobs/
Identity:      GGUF header metadata (general.name, general.architecture, general.file_type)
Verification:  Blob filename IS the SHA-256 hash of the file contents.
               For Ollama-pulled models: verify against Ollama manifest (published digests).
               For HF-sourced GGUF imported into Ollama: verify against HF published hash.
Context:       Embedded in GGUF ({arch}.context_length)

Build from source:
  Ollama is Go + C++ (embeds llama.cpp). Fully buildable:
  1. Clone ollama repo
  2. Apply PT_DENY_ATTACH patch to the C++ runner code (llama/server/ directory)
     - Same hardening.c approach as our llama.cpp patch
     - Ollama's C++ runner is effectively llama-server with Ollama's Go orchestration
  3. cmake -B build -DBUILD_SHARED_LIBS=OFF . && cmake --build build
  4. go build . (links against the hardened C++ runner)
  5. codesign --sign - --options runtime --entitlements entitlements.plist ./ollama
  6. Result: hardened Ollama binary with PT_DENY_ATTACH + Hardened Runtime

Verification chain:
  Agent reads GGUF metadata from the blob file
  Blob filename = sha256-<hash> (the filename IS the hash, built into Ollama's design)
  Agent verifies: SHA-256(blob_file_contents) == filename hash
  Agent sends hash + identity to coordinator
  Coordinator checks against Ollama registry manifest OR HuggingFace
  Hash match -> VERIFIED

What's guaranteed:
  - Model is byte-for-byte the published blob: YES (filename is the hash)
  - GGUF metadata (name, arch, quant) verified: YES (embedded, hash-bound)
  - Provider can't observe prompts/responses: YES (hardened binary, kernel 0-day required)
  - Provider can't swap model at runtime: YES (hardened binary)
  - Multi-model support: YES (Ollama natively handles multiple models, hot-swapping)

Advantages over Path 1 (plain llama.cpp):
  - Ollama handles model download, storage, and management
  - Ollama supports model hot-swapping (load different models on demand)
  - Ollama has a built-in model registry with versioned digests
  - Ollama's API is already widely adopted
  - One binary manages everything (no separate server + agent dance)

This is potentially the best production path for Apple Silicon providers.
```

### Path 7: MLX + SafeTensors + macOS Apple Silicon (via Ollama)

**Status: DESIGNED (Ollama has MLX backend)**

```
Ollama supports MLX as a backend on Apple Silicon (MLX_VERSION file in repo).
When built from source with our hardening patch, this gives us:

  - MLX-speed inference (native Metal optimization)
  - Ollama model management (pull, switch, serve)
  - Hardened process (PT_DENY_ATTACH + Hardened Runtime)

For MLX models in Ollama:
  - Ollama converts/manages MLX weights internally
  - Model identity from Ollama manifest + GGUF metadata (Ollama may store as GGUF even for MLX)
  - Verification via Ollama registry digest

This is the same as Path 6 but using Ollama's MLX backend for faster Apple Silicon inference.
Same hardening, same verification chain.
```

### Path 8: MLX (standalone) + SafeTensors + macOS Apple Silicon

**Status: DESIGNED (not yet built)**

```
Model source:  HuggingFace MLX repo (e.g., mlx-community/Meta-Llama-3.1-8B-Instruct-4bit)
Download:      huggingface-hub CLI or mlx-lm download
Format:        Directory of files: model.safetensors, config.json, tokenizer.json, etc.
Identity:      config.json (model_type, hidden_size, num_layers, max_position_embeddings)
Verification:  SHA-256 of EVERY file in directory vs HF published hashes
Quantization:  From config.json quantization_config or repo name (4bit, 8bit)
Context:       config.json (max_position_embeddings)

Hardening:
  1. Build MLX inference server as PyInstaller onedir bundle
  2. PT_DENY_ATTACH via ctypes at startup:
     import ctypes; libc = ctypes.CDLL('libc.dylib')
     libc.ptrace(31, 0, 0, 0)
  3. Sign all .dylib/.so in the bundle
  4. codesign --options runtime on main binary

Verification chain:
  Agent enumerates all files in model directory
  Agent computes SHA-256 of each file
  Agent reads config.json for identity
  Agent sends {filename: hash} map + identity to coordinator
  Coordinator verifies each hash against HF API
  ALL match -> VERIFIED

What's guaranteed:
  - All model files identical to HF upload: YES
  - config.json can't be forged: YES (its hash is verified)
  - Provider can't observe: YES (PyInstaller + Hardened Runtime)
```

### Path 9: Any engine + Any format + Any platform (self-quantized)

**Status: L0-L2 (hardening possible, model UNVERIFIABLE)**

```
A provider quantizes a model themselves (using llama-quantize, mlx-lm convert,
AutoGPTQ, etc.). The resulting files have no published hash on HuggingFace.

Verification: IMPOSSIBLE
  - We can hash the files, but there's nothing to compare against
  - The provider could have quantized any model and called it anything
  - No cryptographic binding between the files and any trusted source

Hardening: Possible (same as Path 1-4 depending on engine/platform)
  - The process can be hardened
  - But we can't verify WHAT model is running inside the hardened process

Conclusion: Self-quantized models can be hardened (L2) but not verified.
The consumer should see: "L2 Hardened, model identity UNVERIFIED"
```

---

## 11. Summary: The L2+ Verification Matrix

| # | Engine | Format | Platform | L2 Hardening | Model Verification | Status |
|---|---|---|---|---|---|---|
| 1 | llama.cpp | GGUF | macOS Silicon | YES (PT_DENY_ATTACH + Hardened Runtime) | YES (single-file SHA-256 vs HF) | **PROVEN** |
| 2 | MLX (standalone) | SafeTensors | macOS Silicon | YES (PyInstaller + PT_DENY_ATTACH ctypes) | YES (all-file SHA-256 vs HF) | DESIGNED |
| 3 | llama.cpp | GGUF | Linux + NVIDIA (KVM) | YES (VM isolation + VFIO) | YES (single-file SHA-256) | DESIGNED |
| 4 | vLLM | SafeTensors | Linux + NVIDIA (SEV-SNP) | YES (hardware memory encryption) | YES (all-file SHA-256) | DESIGNED |
| 5 | Ollama (stock) | GGUF | Any | NO | PARTIAL | L1 MAX |
| 6 | Ollama (from source) | GGUF | macOS Silicon | YES (PT_DENY_ATTACH in C++ runner) | YES (blob filename = SHA-256) | **DESIGNED (HIGH PRIORITY)** |
| 7 | Ollama (MLX backend) | GGUF/MLX | macOS Silicon | YES (same as Path 6) | YES (same as Path 6) | DESIGNED |
| 8 | MLX (standalone) | SafeTensors | macOS Silicon | YES (PyInstaller + ctypes) | YES (all-file SHA-256 vs HF) | DESIGNED |
| 9 | Any (self-quantized) | Any | Any | Depends on engine | NO (no published hash) | UNVERIFIABLE |

**5 viable L2+ paths with full verification: 1, 2, 3, 4, 6 (and 7, 8 as variants).**

Path 1 is proven. Path 6 (hardened Ollama from source) is the recommended next
build target because:
- Ollama handles model download, management, and hot-swapping out of the box
- Ollama is already the most-used local inference tool (huge provider adoption)
- Building from source is straightforward (cmake + go build)
- The hardening patch is the same C approach we already proved
- Ollama's blob storage uses SHA-256 filenames (verification is built in)
- Ollama supports both llama.cpp AND MLX backends, covering Paths 6 and 7

## 10. What the Consumer Sees

For maximum transparency, each provider on the exchange should show:

```
Meta Llama 3.1 8B Instruct
  Engine: MLX          Format: SafeTensors    Quant: 4-bit
  Hardware: apple-m2-max    Context: 128k     Price: $0.10/Mtok
  Trust: L2 Hardened   E2E: Yes
  Verification: VERIFIED (12/12 files match HuggingFace)
  Source: mlx-community/Meta-Llama-3.1-8B-Instruct-4bit
```

vs

```
Custom Llama 70B
  Engine: Ollama       Format: GGUF           Quant: Q4_K_M
  Hardware: apple-m4-pro    Context: 8k       Price: $0.05/Mtok
  Trust: L1 Contained  E2E: Yes
  Verification: UNVERIFIED (Ollama blob, hash not on HF)
  Source: Self-managed
```

The consumer sees exactly what's verified and what isn't, and decides accordingly.
