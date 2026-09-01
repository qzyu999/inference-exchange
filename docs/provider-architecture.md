# Provider Architecture -- Full E2E Design

## The Provider Is Two Processes

Every provider runs two processes. The agent handles networking and crypto.
The inference engine runs the model. They communicate over localhost HTTP.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Provider Machine                                                    │
│                                                                      │
│  ┌──────────────────────────────┐   ┌─────────────────────────────┐ │
│  │  OCIP Agent                   │   │  Inference Engine            │ │
│  │                               │   │                              │ │
│  │  - WebSocket to coordinator   │   │  - Loads GGUF model          │ │
│  │  - Decrypt incoming requests  │   │  - Runs inference on GPU     │ │
│  │  - Forward plaintext to engine│   │  - Streams tokens back       │ │
│  │  - Encrypt response tokens    │   │  - Speaks OpenAI HTTP API    │ │
│  │  - Heartbeats, reconnection   │   │  - Localhost only            │ │
│  │  - Registration, attestation  │   │                              │ │
│  │                               │   │  Any engine that speaks:     │ │
│  │  Python (compiled binary)     │   │  POST /v1/chat/completions   │ │
│  └──────────────┬────────────────┘   └──────────────┬──────────────┘ │
│                 │                                    │                │
│                 └──── HTTP over localhost/unix ──────┘                │
│                                                                      │
│  Hardened boundary (both processes protected from observation)        │
└─────────────────────────────────────────────────────────────────────┘
```

Why two processes:
- Agent is Python. Easy to update, handles protocol changes, does crypto.
- Engine is compiled. Stable, rarely changes, does one thing well.
- If the engine crashes, the agent restarts it (model stays warm in RAM).
- If the agent crashes, the engine keeps running.
- We can swap inference engines without touching the agent.

## Multi-Engine Support

The agent talks to any engine that implements the OpenAI-compatible HTTP API.
This is a de facto standard that all major inference engines already support.

```
ie-provider start --engine llama-cpp     # default, shipped hardened
ie-provider start --engine ollama        # uses installed ollama
ie-provider start --engine mlx           # uses mlx-lm server
ie-provider start --engine vllm          # Linux GPU, vLLM
ie-provider start --engine custom --port 8081   # anything OpenAI-compatible
```

The interface contract is simple:

```
POST /v1/chat/completions
{
  "messages": [...],
  "max_tokens": N,
  "temperature": T,
  "stream": true
}

Response: SSE stream of OpenAI-format chunks
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}
data: [DONE]
```

Every major engine speaks this natively:

| Engine | Language | GPU | Platforms | API |
|--------|----------|-----|-----------|-----|
| llama.cpp (llama-server) | C++ | Metal, CUDA, ROCm, Vulkan | macOS, Linux, Windows | /v1/chat/completions |
| Ollama | Go + llama.cpp | Metal, CUDA | macOS, Linux, Windows | /v1/chat/completions |
| MLX (mlx-lm) | Python + C++ | Metal | macOS only | /v1/chat/completions |
| vLLM | Python + CUDA | CUDA | Linux | /v1/chat/completions |
| TabbyAPI | Python | CUDA, ROCm | Linux, Windows | /v1/chat/completions |
| TGI (HuggingFace) | Rust + Python | CUDA | Linux | /v1/chat/completions |

## Hardening Levels by Engine

We can only harden what we ship. The trust level depends on the engine:

```
 L2 Hardened           L1 Contained           L0 Open
 ─────────────         ─────────────          ──────────
 We build it           Provider installs      No protection
 We codesign it        We can't harden it     Engine runs bare
 We ship it            Agent still encrypts   
                       requests               

 llama-cpp             Ollama                 Custom / unknown
 (our hardened build)  MLX
                       vLLM
                       TabbyAPI
```

**L2 Hardened (llama-cpp only):**
- We compile llama-server with PT_DENY_ATTACH + Hardened Runtime
- We compile the agent (PyInstaller) with the same protections
- Both shipped as one signed package
- Provider installs one thing: `ie-provider install`
- Neither process can be debugged or memory-read
- Requires kernel 0-day to observe plaintext

**L1 Contained (third-party engines):**
- The agent is still hardened (handles crypto)
- The engine is the provider's own install (ollama, mlx, etc.)
- The provider COULD observe the engine's memory
- But the agent still encrypts requests before forwarding
- So: prompts protected from coordinator, but not from provider

**L0 Open (no hardening):**
- Neither process is hardened
- Testing and development only
- Provider and coordinator can both observe plaintext

The coordinator knows each provider's level (reported at registration) and
routes consumers accordingly. A `most_secure` request only goes to L2 providers.

## The Hardened Boundary (Option C)

For full E2E where neither the provider operator nor the coordinator sees
plaintext:

```
  Consumer                  Coordinator              Provider Machine
                            (opaque relay)           [Hardened Boundary]
  ┌─────────┐              ┌─────────────┐           ┌─────────────────────────┐
  │         │  encrypted   │             │ encrypted │ Agent       Engine      │
  │ IE SDK  │─────────────▶│  routing    │──────────▶│ decrypt ──▶ inference  │
  │         │              │  billing    │           │            tokens      │
  │         │  encrypted   │  matching   │ encrypted │ encrypt ◀── stream     │
  │         │◀─────────────│             │◀──────────│                         │
  │ decrypt │              │ (can't read │           │ (can't be observed     │
  └─────────┘              │  anything)  │           │  by provider operator) │
                           └─────────────┘           └─────────────────────────┘

  Consumer has keypair.
  Agent has keypair.
  Request encrypted to agent's key.
  Request includes consumer's public key (inside the encrypted payload).
  Agent decrypts, forwards plaintext to engine.
  Engine generates tokens.
  Agent encrypts each token to consumer's public key.
  Consumer SDK decrypts.
  
  Coordinator sees only opaque encrypted blobs.
  Provider operator sees only hardened processes (can't read memory).
```

### Key exchange

```
1. Provider registers:     sends agent's X25519 public key to coordinator
2. Consumer sends request: IE SDK generates ephemeral keypair, includes
                          consumer public key in the request body
3. Coordinator encrypts:   encrypts {messages, consumer_pubkey} to
                          provider's public key
4. Agent decrypts:         gets plaintext messages + consumer's public key
5. Agent forwards:         sends plaintext to inference engine
6. Engine responds:        streams tokens back to agent over localhost
7. Agent encrypts tokens:  encrypts each token to consumer's public key
8. Coordinator relays:     passes opaque encrypted chunks to consumer
9. IE SDK decrypts:        consumer sees plaintext response
```

### Billing with encrypted responses

The coordinator can't count tokens in encrypted responses. Two options:

**Option A: Trust-based (simple).** The agent reports token count alongside
each encrypted chunk. The coordinator bills based on the reported count.
The agent is hardened, so the provider can't tamper with it. The coordinator
can compare reported counts against expected ranges (model size, latency,
hardware) to detect anomalies.

**Option B: Commitment scheme (verifiable).** The agent sends a hash
commitment of the token count before streaming starts. After streaming
completes, it reveals the count. If the count doesn't match the number
of chunks received, the coordinator flags it. More complex, marginal benefit
over Option A since the agent is already hardened.

Recommendation: Option A. The hardened agent IS the trust anchor. If you
can't trust the agent's reported token count, you also can't trust that
it's running the right model — and that's what attestation solves.

## Consumer SDK

Two tiers. Consumers choose based on their privacy needs.

### Standard (OpenAI SDK compatible, L0-L1)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
)

# Works out of the box. Prompts encrypted to provider.
# Responses travel through coordinator in plaintext.
response = client.chat.completions.create(
    model="llama-3.1-8b",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### Private (IE SDK, L2+)

```python
from ie_sdk import InferenceExchange

client = InferenceExchange(
    api_key="sk-ie-...",
    # Generates X25519 keypair automatically
    # Encrypts consumer public key into each request
    # Decrypts each response chunk locally
)

# Same API as OpenAI SDK — no code changes needed
# But now responses are also encrypted end-to-end
response = client.chat.completions.create(
    model="llama-3.1-8b",
    messages=[{"role": "user", "content": "confidential question"}],
)
# response.choices[0].message.content is already decrypted
```

Under the hood, the IE SDK:
1. Generates a session keypair on init
2. Includes its public key in the request body (inside the encrypted payload)
3. For streaming: decrypts each SSE chunk with its private key
4. Exposes the same interface as the OpenAI SDK

For applications that don't care about response privacy, the standard
OpenAI SDK still works. Both modes hit the same API endpoint. The
coordinator and provider handle both transparently.

## What Providers Install

### Quick start (L0, no hardening)

```bash
pip install ie-provider
ie-provider start --model llama-3.1-8b
```

Downloads the model, starts the agent + llama-cpp-python in-process.
No hardening. Good for testing and low-trust workloads.

### Standard (L1, encrypted requests)

```bash
pip install ie-provider
ie-provider start --engine ollama    # or mlx, vllm, etc.
```

Agent encrypts/decrypts requests. Engine is the provider's own install.
Provider could observe the engine but the coordinator cannot.

### Hardened (L2, full protection)

```bash
# macOS: download our signed package
curl -fsSL https://install.inference.exchange | sh
ie-provider start
```

Installs the hardened agent + hardened llama-server as a single signed
package. Both processes protected by Hardened Runtime. Provider operator
cannot observe plaintext.

### Confidential (L3, hardware TEE)

Same as L2 but running inside a hardware trusted execution environment
(AMD SEV-SNP, Intel TDX, ARM CCA). The entire VM is encrypted by the CPU.
Even a hypervisor compromise doesn't reveal plaintext.

```bash
# Inside the confidential VM:
ie-provider start --engine llama-cpp --trust confidential
```

## Platform Matrix

| Platform | L0 Open | L1 Contained | L2 Hardened | L3 Confidential |
|----------|---------|--------------|-------------|-----------------|
| macOS (Apple Silicon) | pip install | pip + any engine | Signed package (PT_DENY_ATTACH + Hardened Runtime) | N/A (no TEE VM on macOS) |
| Linux (NVIDIA GPU) | pip install | pip + vllm/ollama | KVM VM + VFIO GPU passthrough | SEV-SNP VM + VFIO |
| Linux (AMD GPU) | pip install | pip + ollama | KVM VM + VFIO GPU passthrough | SEV-SNP VM + VFIO |
| Windows | pip install | pip + ollama | Hyper-V VM + GPU-P | N/A (no SEV-SNP consumer access) |

## Build Pipeline (What We Ship)

### macOS hardened package

```
Source: llama.cpp + hardening.c + OCIP agent (Python)

Build steps:
1. cmake llama.cpp with -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON
2. PyInstaller freeze OCIP agent into standalone binary
3. codesign --options runtime both binaries (same Team ID)
4. Notarize with Apple (so Gatekeeper accepts it)
5. Package as .pkg or .tar.gz

Output: ie-provider-macos-arm64.pkg
  Contains:
  - /usr/local/bin/ie-provider (hardened agent binary)
  - /usr/local/lib/ie/ie-llama-server (hardened inference binary)
```

### Linux VM image (for L2/L3)

```
Build steps:
1. Build llama.cpp with CUDA/ROCm
2. Package agent + server + model downloader into a minimal VM image
3. For L3: sign the VM measurement for SEV-SNP attestation

Output: ie-provider-linux-amd64.qcow2
```

### pip package (for L0/L1)

```
Output: ie-provider on PyPI
  Contains:
  - OCIP agent (Python)
  - llama-cpp-python as optional dependency
  - Engine adapters for ollama, mlx, vllm
  - CLI: ie-provider start/stop/status/benchmark
```
