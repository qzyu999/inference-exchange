# Inference Exchange — System Architecture

## What's Running Right Now

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Your Machine (localhost)                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Coordinator Process (python -m inference_exchange.coordinator)      │   │
│  │  Port 8000 — FastAPI + Uvicorn                                      │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │   │
│  │  │  Web UI       │  │  Consumer API  │  │  Provider Hub            │ │   │
│  │  │  (static HTML)│  │  /v1/chat/...  │  │  /ws/provider            │ │   │
│  │  │  GET /        │  │  /v1/models    │  │                          │ │   │
│  │  │              │  │  /health       │  │  • WebSocket manager     │ │   │
│  │  └──────────────┘  └───────┬───────┘  │  • Provider registry     │ │   │
│  │                            │           │  • Request routing        │ │   │
│  │                            │           │  • Response queue fan-out │ │   │
│  │                            │           └────────────┬─────────────┘ │   │
│  │                            │                        │                │   │
│  └────────────────────────────┼────────────────────────┼────────────────┘   │
│                               │                        │                     │
│                               │  Inference Request     │  WebSocket           │
│                               │  (JSON over WS)        │  (persistent)        │
│                               │                        │                     │
│  ┌────────────────────────────┼────────────────────────┼────────────────┐   │
│  │  Provider Process (python -m inference_exchange.provider)             │   │
│  │                                                                      │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │   │
│  │  │  Agent            │  │  Inference Engine │  │  Model (GGUF)    │  │   │
│  │  │                   │  │                   │  │                   │  │   │
│  │  │  • WS client      │  │  • llama-cpp-py   │  │  Qwen2.5 0.5B   │  │   │
│  │  │  • Reconnect      │  │  • Chat templates │  │  Q4_K_M          │  │   │
│  │  │  • Heartbeats     │  │  • Token stream   │  │  ~400 MB         │  │   │
│  │  │  • Route messages │  │  • CPU inference  │  │                   │  │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Request Flow (Streaming)

```
 Browser / curl / OpenAI SDK
         │
         │  POST /v1/chat/completions
         │  {"model":"default", "messages":[...], "stream":true}
         │
         ▼
┌─────────────────────┐
│   FastAPI Router     │
│   (api.py)           │
│                      │
│ 1. Parse request     │
│ 2. Select provider   │──────── score = (1 - load) × (1 + tps/100)
│ 3. Create response Q │
│ 4. Send to provider  │
│ 5. Stream from Q     │
└─────────┬───────────┘
          │
          │  WebSocket frame (JSON)
          │  {type: "inference_request", request_id: "...", messages: [...]}
          │
          ▼
┌─────────────────────┐
│   Provider Agent     │
│   (agent.py)         │
│                      │
│ 1. Receive request   │
│ 2. Run inference     │──── llama-cpp-python (in thread pool)
│ 3. For each token:   │
│    send chunk back   │
│ 4. Send "done"       │
└─────────┬───────────┘
          │
          │  WebSocket frames (JSON)
          │  {type: "inference_response", request_id: "...", token: "Hello"}
          │  {type: "inference_response", request_id: "...", token: " world"}
          │  {type: "inference_done", request_id: "...", tokens_generated: 42}
          │
          ▼
┌─────────────────────┐
│   Response Queue     │
│   (asyncio.Queue)    │
│                      │
│   Chunks are read    │
│   by the SSE         │
│   generator in       │
│   api.py             │
└─────────┬───────────┘
          │
          │  Server-Sent Events (SSE)
          │  data: {"choices":[{"delta":{"content":"Hello"}}]}
          │  data: {"choices":[{"delta":{"content":" world"}}]}
          │  data: [DONE]
          │
          ▼
    Browser / SDK
    (renders streaming text)
```

## Component Interaction

```
┌────────────────────────────────────────────────────────────────┐
│                      COORDINATOR                                │
│                                                                 │
│  ┌─────────┐     ┌──────────────┐     ┌───────────────────┐  │
│  │ api.py  │────▶│ provider_hub │────▶│ ConnectedProvider  │  │
│  │         │     │   .py        │     │                    │  │
│  │ Routes: │     │              │     │ • provider_id      │  │
│  │ • POST  │     │ • register   │     │ • name             │  │
│  │   /v1/* │     │ • disconnect │     │ • ws (WebSocket)   │  │
│  │ • GET   │     │ • select     │     │ • capabilities     │  │
│  │   /v1/* │     │ • route msg  │     │ • active_requests  │  │
│  │         │◀────│ • queue mgmt │     │ • load_factor      │  │
│  └─────────┘     └──────────────┘     │ • score_for_req()  │  │
│                                        └───────────────────┘  │
│                                                                 │
│  ┌─────────┐                                                   │
│  │ static/ │  Serves index.html (chat UI) at GET /             │
│  │index.html│                                                   │
│  └─────────┘                                                   │
└────────────────────────────────────────────────────────────────┘
         ▲                                    │
         │ HTTP (SSE stream)                  │ WebSocket (JSON frames)
         │                                    ▼
┌─────────────┐                    ┌────────────────────────────┐
│  Consumer   │                    │         PROVIDER            │
│             │                    │                             │
│ • Browser   │                    │  ┌─────────┐  ┌─────────┐ │
│ • curl      │                    │  │ agent.py│  │inference│ │
│ • OpenAI SDK│                    │  │         │  │  .py    │ │
│ • Any HTTP  │                    │  │ • WS    │  │         │ │
│   client    │                    │  │   loop  │──▶│ • Llama │ │
│             │                    │  │ • HB    │  │   model │ │
│             │                    │  │ • Tasks │◀──│ • Stream│ │
│             │                    │  └─────────┘  └─────────┘ │
└─────────────┘                    │                             │
                                   │  Model file:                │
                                   │  ~/.inference-exchange/     │
                                   │    models/Qwen2.5-0.5B-    │
                                   │    Instruct-Q4_K_M.gguf    │
                                   └────────────────────────────┘
```

## Protocol Messages (OCIP Wire Format)

```
                Provider → Coordinator
                ═══════════════════════

┌─────────────────────────────────────────────────────────┐
│ REGISTER (first message after WS connect)               │
│                                                         │
│ {                                                       │
│   "type": "register",                                   │
│   "provider_name": "local-provider",                    │
│   "capabilities": {                                     │
│     "models": ["Qwen2.5 0.5B Instruct", "default"],    │
│     "max_concurrent": 2,                                │
│     "trust_level": "open",                              │
│     "hardware": "intel-amd64",                          │
│     "memory_gb": 0,                                     │
│     "measured_tps": 0                                   │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ HEARTBEAT (every 10 seconds)                            │
│                                                         │
│ {                                                       │
│   "type": "heartbeat",                                  │
│   "active_requests": 1,                                 │
│   "loaded_models": ["Qwen2.5 0.5B Instruct"],          │
│   "memory_used_gb": 0.4,                                │
│   "cpu_percent": 45.2                                   │
│ }                                                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ INFERENCE_RESPONSE (one per token generated)            │
│                                                         │
│ { "type": "inference_response",                         │
│   "request_id": "042e42df-...",                         │
│   "token": "Hello",                                     │
│   "finish_reason": null }                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ INFERENCE_DONE (after last token)                       │
│                                                         │
│ { "type": "inference_done",                             │
│   "request_id": "042e42df-...",                         │
│   "tokens_generated": 42,                               │
│   "time_seconds": 3.2 }                                 │
└─────────────────────────────────────────────────────────┘


                Coordinator → Provider
                ═══════════════════════

┌─────────────────────────────────────────────────────────┐
│ INFERENCE_REQUEST                                       │
│                                                         │
│ { "type": "inference_request",                          │
│   "request_id": "042e42df-...",                         │
│   "model": "default",                                   │
│   "messages": [                                         │
│     {"role": "user", "content": "What is 2+2?"}        │
│   ],                                                    │
│   "max_tokens": 1024,                                   │
│   "temperature": 0.7,                                   │
│   "stream": true }                                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ CANCEL_REQUEST                                          │
│                                                         │
│ { "type": "cancel_request",                             │
│   "request_id": "042e42df-..." }                        │
└─────────────────────────────────────────────────────────┘
```

## Provider Selection (Routing)

```
Consumer Request arrives: model="default"

    ┌───────────────────────────────────────────────┐
    │          Provider Registry                     │
    │                                                │
    │  Provider A                                    │
    │    models: [Qwen2.5, default]                  │
    │    load: 0/2 = 0.0                             │
    │    tps: 25.0                                   │
    │    score = (1 - 0.0) × (1 + 25/100) = 1.25  ◄── SELECTED
    │                                                │
    │  Provider B  (future)                          │
    │    models: [Llama-3-8B, default]               │
    │    load: 1/2 = 0.5                             │
    │    tps: 40.0                                   │
    │    score = (1 - 0.5) × (1 + 40/100) = 0.70    │
    │                                                │
    │  Provider C  (future)                          │
    │    models: [Mistral-7B]  ← no "default"        │
    │    score = -1  (can't serve this model)         │
    │                                                │
    └───────────────────────────────────────────────┘
```

## Future: Production Deployment

```
                                ┌──────────────────────┐
                                │   CloudFront CDN     │
    Consumers ─── HTTPS ───────▶│   (React SPA)        │
                                └──────────────────────┘

                                ┌──────────────────────┐
    Consumers ─── HTTPS ───────▶│   ALB                │
    (API)                       │   (TLS termination)  │
                                └──────────┬───────────┘
                                           │
                          ┌────────────────┼────────────────┐
                          ▼                ▼                 ▼
                   ┌────────────┐  ┌────────────┐   ┌────────────┐
                   │Coordinator │  │Coordinator │   │Coordinator │
                   │  Task 1    │  │  Task 2    │   │  Task 3    │
                   └─────┬──────┘  └─────┬──────┘   └─────┬──────┘
                         │               │                 │
                         ▼               ▼                 ▼
                   ┌─────────────────────────────────────────────┐
                   │              Redis (ElastiCache)             │
                   │  • Provider state (shared across tasks)      │
                   │  • Active request tracking                   │
                   │  • Pub/sub for WS fan-out                    │
                   └─────────────────────────────────────────────┘
                   ┌─────────────────────────────────────────────┐
                   │              PostgreSQL (RDS)                │
                   │  • Users, API keys, billing                  │
                   │  • Provider profiles, attestation            │
                   │  • Request history, audit log                │
                   └─────────────────────────────────────────────┘

    ════════════════════════════════════════════════════════════════
                          Internet / WebSocket
    ════════════════════════════════════════════════════════════════

     ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
     │Mac Mini  │    │Linux Box │    │Ryzen Pro │    │Mac Studio│
     │M4 Pro    │    │+ RTX 4090│    │SEV-SNP   │    │M2 Ultra  │
     │          │    │          │    │          │    │          │
     │ Provider │    │ Provider │    │ Provider │    │ Provider │
     │ Agent    │    │ Agent    │    │ Agent    │    │ Agent    │
     │          │    │          │    │          │    │          │
     │Trust:    │    │Trust:    │    │Trust:    │    │Trust:    │
     │HARDENED  │    │CONTAINED │    │CONFID.   │    │HARDENED  │
     └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

## File → Responsibility Map

```
inference_exchange/
│
├── coordinator/
│   ├── main.py           Creates FastAPI app, mounts routes + WS + static
│   ├── api.py            Consumer-facing OpenAI-compatible endpoints
│   ├── provider_hub.py   WebSocket connection manager + provider scoring
│   └── static/
│       └── index.html    Chat web UI (single-page, no build step)
│
├── provider/
│   ├── main.py           Provider entrypoint (find model, start agent)
│   ├── agent.py          WebSocket client loop + inference task dispatch
│   └── inference.py      llama-cpp-python wrapper (load model, stream tokens)
│
├── shared/
│   └── protocol.py       OCIP message types (Pydantic models)
│
├── config.py             Configuration (ports, model paths, defaults)
└── cli.py                CLI tools (download-model, list-models)
```
