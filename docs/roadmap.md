# Inference Exchange — Roadmap & Status

## Current State — 290+ tests, modular codebase, spec-aligned

### Core Infrastructure ✅
- **Coordinator** — FastAPI, modular routes (auth, exchange, inference, admin)
- **Provider Agent** — WebSocket client, inference via llama-cpp-python
- **OCIP Agent** — Two-process architecture (agent + isolated inference server)
- **Protocol** — OCIP wire format with versioning, REGISTERED confirmation
- **Persistence** — SQLite (accounts, API keys, billing — survives restarts)
- **Structured Errors** — OCIP-typed errors (NoProviderAvailable, ProviderTimeout, etc.)

### Matching Engine ✅
- Multi-dimensional scoring: price × speed × trust × load × reputation
- Consumer preference routing: cheapest / fastest / most_secure / balanced
- Session affinity (cache benefit for repeat conversations)
- Request queuing with FIFO dispatch (50 depth, 30s timeout)
- Request retry on provider failure
- Full decision traces per request

### Security & Privacy ✅
- E2E encryption (X25519 + XSalsa20-Poly1305, per-request forward secrecy)
- Attestation challenge-response protocol (5-minute intervals)
- HF model hash verification (SHA-256 against HuggingFace)
- Hardening plans for macOS, Windows, Linux (documented)
- Hardening C modules written (macOS PT_DENY_ATTACH, Windows mitigations)
- OCIP confidence levels (L0-L3)

### Billing & Economics ✅
- Per-request billing (input + output tokens, proportional pricing)
- Provider earnings (90/10 split, platform fee)
- Multi-tenant API keys with isolated balances
- Rate limiting (30 req/min per key, token bucket)
- Financial invariants verified (290+ tests, no money lost)
- Billing/caching economics fully documented

### Observability ✅
- Consumer dashboard + Admin control plane
- Real-time WebSocket event feed (match, billing, connect/disconnect, attestation)
- TPS performance tracking (EMA + hardware lookup table)
- Provider reputation (EMA, degradation detection)
- Decision traces, telemetry, model discovery

### Testing ✅
- 290+ tests across 17 test files
- Financial invariant property tests (1000 random events, books balance)
- Store.py (SQLite) fully tested including persistence across restarts
- TPS tracker fully tested (EMA, hardware lookup, anomaly detection)
- Crypto (encrypt/decrypt roundtrip, forward secrecy, wrong key)
- Session affinity, disconnect handling, event bus, rate limiter, matching
- OpenAI SDK compatibility proven

### React Frontend ✅
- Full SPA: Landing, Exchange, Chat, Models, Providers, Admin pages
- Typed API client (SWR for data fetching, auto-refresh)
- Streaming chat with SSE (model picker, preference selector, cancel)
- Exchange "trading floor" — order depth, live providers, real-time WebSocket feed
- Model search (HuggingFace integration + exchange catalog)
- Provider cards (status, trust, TPS, reputation, hardware)
- Admin dashboard (accounts, TPS, reputation, decision traces, raw state)
- Tailwind CSS, Vite build (227KB JS + 17KB CSS production bundle)
- Vite proxy config for local dev (no CORS issues)

### Documentation ✅ (12 docs)
- OCIP Protocol Spec (7 documents)
- Architecture, billing economics, consumer integration guide
- Platform hardening plans (macOS, Windows, Linux)
- Agent architecture, project review, roadmap, system design

---

## Completed Phases

### Phase 1: Refactoring ✅
- ~~Split api.py (1133 lines) into 5 modules~~ ✅
- ~~Remove dead code (billing.py → billing_memory.py, auth.py → auth_memory.py)~~ ✅
- ~~Fix prompt_tokens:10 bug~~ ✅
- ~~Fix API key plaintext logging~~ ✅
- ~~Deprecate provider/agent.py~~ ✅
- ~~Align ConfidenceLevel~~ ✅

### Phase 2: Spec Alignment ✅
- ~~Add protocol_version to RegisterMessage~~ ✅
- ~~Implement REGISTERED confirmation message~~ ✅
- ~~Structured OCIP error types~~ ✅
- ~~Encryption key endpoint~~ ✅

### Phase 2.5: Test Gap Filling ✅
- ~~Store.py (SQLite persistence) tests~~ ✅ (41 tests)
- ~~TPS tracker tests~~ ✅ (46 tests)

### Phase 3: React Frontend ✅
- ~~React SPA with Vite + TypeScript + Tailwind~~ ✅
- ~~Landing page with live stats~~ ✅
- ~~Exchange page with depth, providers, traces, WebSocket event feed~~ ✅
- ~~Chat page with streaming SSE + model/preference selectors~~ ✅
- ~~Models page with HuggingFace search~~ ✅
- ~~Providers page with reputation + TPS cards~~ ✅
- ~~Admin page with accounts, traces, telemetry, raw state~~ ✅

---

## Next Steps

### Deployment Phases (see docs/system-design.md for full detail)

**Phase A: Local POC (current)**
- Vite dev server (:3000) proxies to coordinator (:8000)
- SQLite, in-process state, localhost-only
- Docker optional (demo with 3 providers)

**Phase B: Single-Node Deploy**
- `vite build` → static SPA on CDN (Cloudflare Pages)
- Coordinator on a single VM (Fly.io / Railway) with TLS via Caddy
- SQLite in WAL mode (still OK for <100 concurrent)
- Providers connect remotely over WSS

**Phase C: Horizontally Scaled**
- PostgreSQL replaces SQLite (distributed ACID for billing)
- Redis for provider registry, session affinity, rate limits
- N coordinator containers behind ALB, sticky WS sessions
- Separate domains: `console.inference.exchange` (CDN), `api.inference.exchange` (ALB)

**Phase D: Full Production**
- Stripe (real deposits + provider payouts)
- OAuth user accounts
- Monitoring (Datadog / Prometheus)
- Hardware attestation verification
- Geographic routing

### Software (no special hardware needed)
1. **Wire matching/ module into live system** — replace provider_hub's inline scoring with the formal matching engine
2. **Provider pip package** — `pip install ie-provider && ie-provider start`
3. **Single-node deploy** — Fly.io/Railway with Caddy reverse proxy, SPA on CDN

### Requires Specific Hardware
4. **Apple Silicon hardened build** — compile llama.cpp with hardening, codesign, test on M1+
5. **Stripe integration** — real money deposits + provider payouts
6. **Remote provider demo** — ngrok/Tailscale, provider on different machine

### Ecosystem
7. **AMD SEV-SNP Level 3** — hardware-encrypted inference
8. **Linux KVM + VFIO** — full GPU passthrough with hypervisor isolation
9. **Tool configuration guides** — Cursor, Continue, Aider, LangChain
10. **Federation** — multiple coordinators sharing provider fleet

---

## Codebase Stats

- **~5,500 lines** Python source (40+ files, modular)
- **~1,200 lines** TypeScript/React (7 pages + API client + layout)
- **~3,000 lines** tests (17 files, 290+ tests)
- **~4,000 lines** documentation (12 docs)
- **~1,000 lines** OCIP spec (7 documents)
- **Total: ~14,700 lines** across both repos

## Repos
- **inference-exchange**: https://github.com/qzyu999/inference-exchange (MIT)
- **ocip**: https://github.com/qzyu999/ocip (Apache 2.0)
