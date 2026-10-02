# OCIP Agent + Inference Server — Architecture

## Overview

The OCIP provider runs as **two separate processes** on the provider's machine:

1. **OCIP Agent** — network-facing relay that handles encryption and coordinator communication
2. **OCIP Inference Server** — isolated process that loads the model and runs inference

The agent manages the server's lifecycle (starts, monitors, restarts it). They communicate
over localhost HTTP. In production, the inference server is hardened so the machine
operator cannot read its memory.

## Why Two Processes?

A single monolithic process would be simpler, but two processes provide:

- **Flexibility** — the inference server can be any engine (llama.cpp, ollama, MLX)
- **Isolation** — the inference server has no network access, reducing attack surface
- **Hardening** — only the inference server needs OS-level hardening (compiled C binary), the agent stays as easy-to-update Python
- **Independent failures** — if the agent crashes, the server keeps model loaded; if the server crashes, the agent restarts it

## Startup Sequence

```
User runs: python ocip_agent/agent.py --name "my-node"

┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Agent starts                                         │
│                                                              │
│   • Generates X25519 encryption keypair (in memory)         │
│   • Finds model file (~/.inference-exchange/models/*.gguf)  │
│   • Spawns inference server as CHILD PROCESS                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ subprocess.Popen(ocip_server/server.py)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Inference server starts (separate process)           │
│                                                              │
│   • Loads GGUF model into memory (llama-cpp-python)         │
│   • Reads model identity from GGUF header metadata          │
│   • Computes SHA-256 hash of model file                     │
│   • Starts HTTP server on 127.0.0.1:9999 ONLY              │
│   • Exposes: /health, /identity, /v1/chat/completions       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Agent polls GET /health until 200 OK
                               │ Agent fetches GET /identity → model name + hash
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Agent connects to coordinator                        │
│                                                              │
│   • Opens WebSocket to ws://coordinator:8000/ws/provider    │
│   • Sends REGISTER message with:                            │
│     - provider name                                         │
│     - model name (from inference server's /identity)        │
│     - X25519 public key (for E2E encryption)                │
│     - price, trust level, hardware info                     │
│   • Starts heartbeat loop (every 10s)                       │
│   • Starts health monitor (every 15s checks server /health) │
│   • Ready to receive requests                               │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow

```
CONSUMER                    COORDINATOR                 OCIP AGENT              INFERENCE SERVER
   │                            │                          │                         │
   │  POST /v1/chat/completions │                          │                         │
   │  {"messages": [...]}       │                          │                         │
   │───────────────────────────▶│                          │                         │
   │                            │                          │                         │
   │                            │  1. Select best provider │                         │
   │                            │     (matching engine)    │                         │
   │                            │                          │                         │
   │                            │  2. Encrypt messages     │                         │
   │                            │     with provider's      │                         │
   │                            │     X25519 public key    │                         │
   │                            │     (fresh ephemeral     │                         │
   │                            │      key per request)    │                         │
   │                            │                          │                         │
   │                            │  3. Send over WebSocket: │                         │
   │                            │  {type: inference_req,   │                         │
   │                            │   encrypted_body: {      │                         │
   │                            │     eph_key, nonce,      │                         │
   │                            │     ciphertext}}         │                         │
   │                            │─────────────────────────▶│                         │
   │                            │                          │                         │
   │                            │                          │  4. DECRYPT with        │
   │                            │                          │     X25519 private key  │
   │                            │                          │     → plaintext msgs    │
   │                            │                          │                         │
   │                            │                          │  5. Forward plaintext   │
   │                            │                          │     POST localhost:9999 │
   │                            │                          │     /v1/chat/completions│
   │                            │                          │─────────────────────────▶│
   │                            │                          │                         │
   │                            │                          │                         │  6. Run inference
   │                            │                          │                         │     (Metal/CUDA GPU)
   │                            │                          │                         │
   │                            │                          │  SSE: token "Hello"     │
   │                            │                          │◀─────────────────────────│
   │                            │  WS: {token: "Hello"}    │                         │
   │                            │◀─────────────────────────│                         │
   │  SSE: "Hello"              │                          │                         │
   │◀───────────────────────────│                          │                         │
   │                            │                          │                         │
   │                            │                          │  SSE: token " world"    │
   │                            │                          │◀─────────────────────────│
   │                            │  WS: {token: " world"}   │                         │
   │                            │◀─────────────────────────│                         │
   │  SSE: " world"             │                          │                         │
   │◀───────────────────────────│                          │                         │
   │                            │                          │                         │
   │                            │                          │  SSE: [DONE]            │
   │                            │                          │◀─────────────────────────│
   │                            │  WS: {done, 2 tok, 0.3s}│                         │
   │                            │◀─────────────────────────│                         │
   │  SSE: [DONE]               │                          │                         │
   │◀───────────────────────────│                          │                         │
   │                            │                          │                         │
   │                            │  7. Bill consumer        │                         │
   │                            │  8. Record TPS           │                         │
```

## Process Relationship

```
Provider's Machine
│
├── Process 1: OCIP Agent (Python) ─── started by user
│   │
│   ├── Owns: WebSocket to coordinator (encrypted)
│   ├── Owns: X25519 private key (for decryption)
│   ├── Owns: HTTP client to inference server (localhost)
│   ├── Does: Decrypt, forward, stream tokens back, heartbeats
│   └── Manages: starts/stops/restarts Process 2
│
└── Process 2: OCIP Inference Server (Python or compiled C) ─── started BY agent
    │
    ├── Owns: Model weights in memory (GGUF loaded)
    ├── Owns: GPU context (Metal/CUDA/CPU)
    ├── Listens: 127.0.0.1:9999 ONLY (not reachable from outside)
    ├── Exposes: /health, /identity, /v1/chat/completions
    ├── Does: Load model, run inference, stream tokens
    └── In production: HARDENED (memory unreadable by operator)
```

## What Each Component Knows

```
                    Sees plaintext    Has network     Has GPU     Needs hardening
                    prompts?          access?         access?     in production?
                    ──────────────    ────────────    ────────    ───────────────
Coordinator         NO (encrypted)    YES             NO          YES (runs in CVM)
OCIP Agent          YES (decrypts)    YES             NO          Optional
Inference Server    YES (receives)    NO (local only) YES         YES (critical)
```

The agent sees plaintext briefly (microseconds between decrypt and forward).
The inference server holds plaintext in memory during inference (seconds).
Hardening the inference server is the priority because it holds data longest.

## Health & Recovery

```
Normal operation:
  Agent runs heartbeat every 10s → coordinator knows we're alive
  Agent checks inference server /health every 15s → confirms model is loaded

Inference server crash:
  Agent detects failed /health check
  → Wait 2s, restart server
  → If crashes again: wait 4s, 8s, 16s, 30s (exponential backoff)
  → After 5 failures: agent gives up and exits
  → Model stays cold until restart (cold start ~0.3-30s depending on model size)

Coordinator disconnect:
  → Agent retries connection every 5s
  → Inference server keeps running (not affected)
  → In-flight requests: error sent to consumer
  → On reconnect: re-registers, immediately available for requests

Consumer cancels (closes HTTP connection):
  → Coordinator sends CANCEL_REQUEST via WebSocket
  → Agent cancels the asyncio task for that request
  → HTTP stream to inference server is closed
  → Inference server detects closed connection, stops generating
  → GPU resources freed immediately
```

## Cancellation Detail

```
Consumer disconnects:
  │
  ▼
Coordinator detects broken HTTP connection
  │
  ├── Sends to agent: {type: "cancel_request", request_id: "abc123"}
  │
  ▼
Agent receives cancel:
  │
  ├── Looks up request_id in self._active_requests dict
  ├── Calls task.cancel() on the asyncio task
  │
  ▼
Task gets CancelledError:
  │
  ├── The httpx stream to inference server is closed (context manager exits)
  ├── Inference server sees connection reset → stops inference
  └── No more tokens generated, GPU freed
```

## File Locations

```
ocip_agent/
├── __init__.py          Package description
└── agent.py             The full agent: lifecycle, encryption, streaming, recovery

ocip_server/
├── __init__.py          Package description
└── server.py            Isolated inference: model loading, identity, completions API
```

## Running It

```bash
# One command starts everything:
python ocip_agent/agent.py --name "my-node" --price-output 0.10 --trust hardened

# Options:
#   --coordinator ws://coordinator:8000/ws/provider   (coordinator URL)
#   --model /path/to/model.gguf                      (auto-detected if omitted)
#   --port 9999                                       (inference server port)
#   --n-gpu-layers -1                                 (-1 = all layers on GPU)
#   --trust hardened                                  (open/contained/hardened/confidential)
#   --price-output 0.15                               ($/Mtok output)
```

## Production Hardening (Not Yet Implemented)

In the current POC, both processes are regular Python processes (fully observable
by the operator). For production Level 2+:

**The inference server** must be replaced with a compiled, hardened binary:
- macOS: llama.cpp compiled with PT_DENY_ATTACH + codesigned with Hardened Runtime
- Windows: llama.cpp compiled with SetProcessMitigationPolicy + HVCI
- Linux: llama.cpp running inside a KVM/Firecracker VM with VFIO GPU passthrough

**The agent** can stay as Python — it only holds plaintext for microseconds
during the decrypt-and-forward step. Hardening it is defense-in-depth but
not critical.

See platform-specific docs:
- [Apple Silicon hardening](apple-silicon-hardening.md)
- [Windows hardening](windows-hardening.md)
- [Linux hardening](linux-hardening.md)
