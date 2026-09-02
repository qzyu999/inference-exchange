# Inference Exchange -- System Architecture

## Current Architecture

```
  Consumer (Browser / SDK / curl)
       |
       | POST /v1/chat/completions (HTTPS in prod)
       v
  +----------------------------------------------------------+
  |  Coordinator (FastAPI + Uvicorn, port 8000)               |
  |                                                           |
  |  routes_inference.py  - chat completions (OpenAI-compat)  |
  |  routes_exchange.py   - marketplace data (depth, pricing) |
  |  routes_auth.py       - API key management                |
  |  routes_admin.py      - admin state + provider tokens     |
  |  provider_hub.py      - WebSocket manager, routing        |
  |  matching/            - formal scoring engine (GreedyStrategy) |
  |  store.py             - SQLite persistence (billing, keys)|
  |  reputation.py        - provider reputation (EMA)         |
  |  tps_tracker.py       - TPS measurement + anomaly detect  |
  |  event_bus.py         - real-time WebSocket event feed    |
  |  rate_limiter.py      - per-key token bucket              |
  |  audit_log.py         - append-only hash-chained log      |
  |  model_registry.py    - HuggingFace hash verification     |
  +-----------------------------+-----------------------------+
                                |
                                | WebSocket (E2E encrypted)
                                v
  +----------------------------------------------------------+
  |  Provider Machine                                         |
  |                                                           |
  |  +-------------------------+  +--------------------------+|
  |  | OCIP Agent (Python)     |  | Inference Engine         ||
  |  | ocip_agent/agent.py     |  | (llama-server, hardened) ||
  |  |                         |  |                          ||
  |  | - WS to coordinator     |  | - Loads GGUF model       ||
  |  | - X25519 decrypt/encrypt|  | - Metal/CUDA inference   ||
  |  | - Model identity (GGUF) |  | - PT_DENY_ATTACH         ||
  |  | - Attestation response  |  | - Hardened Runtime       ||
  |  | - Token auth            |  | - Localhost only         ||
  |  +------------+------------+  +------------+-------------+|
  |               |                            |              |
  |               +--- HTTP localhost:9999 ----+              |
  +----------------------------------------------------------+
```

## Request Flow

```
Consumer sends: POST /v1/chat/completions
  |
  v
1. Auth: resolve consumer_id from API key (SHA-256 hash lookup)
2. Rate limit: token bucket check (30 req/min per key)
3. Match: GreedyStrategy scores all providers
   - Weights by preference (cheapest/fastest/most_secure/balanced)
   - Hard constraints: model, min_confidence, max_price
   - Soft: price, speed, trust, load, reputation, session affinity
4. If no provider: queue (50 depth, 30s timeout, FIFO dispatch)
5. Encrypt: X25519 encrypt messages to provider's public key
   - Include consumer_public_key for response E2E (IE SDK mode)
6. Send: WebSocket frame to provider
7. Provider agent: decrypt, forward to localhost inference engine
8. Engine: generate tokens, stream back over localhost
9. Agent: encrypt each token to consumer key (if provided), send via WS
10. Coordinator: relay to consumer as SSE (OpenAI format)
11. Bill: charge consumer, credit provider (90/10 split)
12. Record: TPS, reputation, audit log, event bus
```

## File Map

```
inference_exchange/
  coordinator/
    main.py              - FastAPI app, WS endpoints, lifespan
    dependencies.py      - Global singletons (hub, billing, auth, etc.)
    routes_inference.py  - POST /v1/chat/completions
    routes_exchange.py   - GET /v1/exchange/* (stats, providers, depth, pricing)
    routes_auth.py       - API key CRUD
    routes_admin.py      - Admin state dump, provider token management
    provider_hub.py      - Provider registry, select_provider (matching engine)
    store.py             - SQLite (accounts, keys, billing, provider history)
    audit_log.py         - Append-only JSONL with hash chaining
    event_bus.py         - Pub/sub for real-time WebSocket events
    rate_limiter.py      - Per-key token bucket
    reputation.py        - EMA-based provider reputation
    tps_tracker.py       - TPS measurement + hardware lookup
    model_registry.py    - HuggingFace model hash verification
    matching/
      models.py          - InferenceOrder, ProviderOffer, MatchResult
      strategy.py        - GreedyStrategy, BatchAuctionStrategy, compute_score
      engine.py          - MatchingEngine orchestrator (batch mode)
    auth_memory.py       - In-memory auth (legacy, used by tests)
    billing_memory.py    - In-memory billing (legacy, used by tests)
    static/              - Old static HTML dashboard (legacy)

  provider/
    main.py              - Simple provider entry point
    agent.py             - Simple single-process agent (deprecated)
    inference.py         - llama-cpp-python wrapper
    model_identity.py    - GGUF metadata reader + SHA-256 hash

  shared/
    protocol.py          - OCIP wire format (Pydantic models)
    crypto.py            - X25519 + XSalsa20-Poly1305 encryption
    errors.py            - Structured OCIP error types

  config.py              - CoordinatorConfig, ProviderConfig
  ie_sdk.py              - Consumer SDK with E2E response decryption

ocip_agent/
  agent.py               - Production agent: lifecycle, crypto, streaming, attestation

ocip_server/
  server.py              - Isolated inference server (Python, for testing)

provider-hardened/
  hardening.c/.h         - PT_DENY_ATTACH + core dump disable + SIP check
  build-poc.sh           - Build hardened llama-server
  build-agent.sh         - Build hardened agent (PyInstaller + codesign)
  run-poc.sh             - Start hardened provider (server + agent)
  verify-poc.sh          - Verify hardening (debugger blocked, etc.)
  entitlements.plist     - Codesign entitlements (no get-task-allow)
  M3-GUIDE.md            - Step-by-step for Apple Silicon

web/
  src/
    main.tsx             - React router (8 routes)
    components/Layout.tsx - Nav bar, connection status
    pages/Landing.tsx    - Hero, features, trust levels, pricing
    pages/Exchange.tsx   - Depth chart, provider ladder, trade ticker
    pages/Chat.tsx       - Streaming chat with preferences
    pages/Models.tsx     - Model search (HuggingFace + exchange)
    pages/Providers.tsx  - Provider cards, setup CTA
    pages/Billing.tsx    - Balance, transactions
    pages/Keys.tsx       - API key management + quick start
    pages/Admin.tsx      - System state, traces, telemetry
    lib/api.ts           - Typed API client (SWR)
    lib/useWebSocket.ts  - WS hook + coordinator status

tests/                   - 290+ tests (17 files)
docs/                    - 16 documentation files
```

## Persistence

- **SQLite** (`~/.inference-exchange/exchange.db`): accounts, API keys,
  billing transactions, provider history, provider tokens
- **Audit log** (`~/.inference-exchange/audit.jsonl`): append-only,
  hash-chained, records billing + attestation + connect/disconnect
- **In-memory**: provider connections, response queues, session affinity,
  rate limit counters, reputation EMA, TPS EMA

## Security Layers

| Layer | Mechanism |
|-------|-----------|
| Transport encryption | X25519 per-request (forward secrecy) |
| Response encryption | X25519 to consumer key (IE SDK mode) |
| Process hardening | PT_DENY_ATTACH + Hardened Runtime (macOS) |
| Model verification | GGUF metadata + SHA-256 vs HuggingFace |
| Provider auth | Token-based WebSocket authentication |
| Consumer auth | API keys (SHA-256 hashed in SQLite) |
| Attestation | Periodic challenge with hardening evidence |
| Audit | Hash-chained append-only log |
| Rate limiting | Per-key token bucket (30 req/min) |

See [threat-model.md](threat-model.md) for the full attack surface analysis.
