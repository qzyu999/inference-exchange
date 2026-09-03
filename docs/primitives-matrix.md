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
| llama.cpp | C++ | All | GGUF | Metal, CUDA, ROCm, Vulkan | /v1/chat/completions | Yes (compiled, PT_DENY_ATTACH) |
| MLX / mlx-lm | Python+C++ | macOS only | SafeTensors | Metal (native) | /v1/chat/completions | Partial (Python: PyInstaller; C++ backend: unclear) |
| Ollama | Go + llama.cpp | All | GGUF (internal) | Metal, CUDA | /v1/chat/completions | No (not our binary) |
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

| Property | GGUF + llama.cpp | SafeTensors + MLX | SafeTensors + vLLM | Ollama | Self-quantized |
|---|---|---|---|---|---|
| Model name | VERIFY (embedded in GGUF header) | TRUST (config.json, separate file) | TRUST (config.json) | TRUST (Ollama manifest) | TRUST (provider claims) |
| Architecture | VERIFY (GGUF header) | TRUST (config.json) | TRUST (config.json) | TRUST (manifest) | TRUST |
| Quantization | VERIFY (GGUF file_type) | INFER (from repo name/config) | INFER | UNKNOWN (Ollama internal) | TRUST |
| Context length | VERIFY (GGUF header) | TRUST (config.json) | TRUST (config.json) | TRUST | TRUST |
| File integrity | VERIFY (SHA-256 vs HF published hash) | VERIFY (SHA-256 vs HF) | VERIFY (SHA-256 vs HF) | PARTIAL (Ollama may repackage) | UNVERIFIABLE |
| Model quality | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE | UNVERIFIABLE |

**Key insight:** GGUF is the only format where model identity is embedded IN
the weight file and can be verified cryptographically. For all other formats,
model identity is in accompanying metadata files that could theoretically be
mismatched or forged (though the SHA-256 of the weight files still proves
they match a specific HF upload).

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
| MLX | No (needs conversion) | YES | No | macOS only | PyInstaller + codesign | config.json |
| Ollama | YES (internal) | No | YES | All | No (not our binary) | Ollama API |
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
   FALSE for non-GGUF formats at L0/L1. The identity comes from metadata files
   that are separate from the weights. A malicious provider could mismatch them.

2. "All providers are equally secure" -- FALSE. L0 has zero protection. L1 has
   transit encryption only. L2 has kernel-level protection but only for specific
   engine/platform combos. L3 doesn't exist yet.

3. "MLX providers have the same guarantees as llama.cpp providers" -- FALSE.
   MLX is Python, harder to harden, and SafeTensors have no embedded metadata.

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
- Non-GGUF model identity should say "reported" not "verified"
- Ollama models should note "metadata verified, file hash not verifiable"
- L0/L1 trust should clearly state "provider CAN observe your data"
- Self-quantized models should note "not verified against any source"

### For beta (engine-agnostic support):
- MLX engine adapter (SafeTensors + config.json identity)
- vLLM engine adapter (SafeTensors + config.json identity)
- Ollama engine adapter (manifest identity)
- Per-engine identity verification with clear confidence levels
