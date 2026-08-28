# Inference Exchange — Roadmap & Status

## Current State (what's built and working)

### Core Infrastructure ✅
- **Coordinator** — FastAPI, WebSocket provider hub, request routing
- **Provider Agent** — WebSocket client, inference via llama-cpp-python, auto-reconnect
- **Protocol** — OCIP wire format (JSON over WebSocket/HTTP+SSE)

### Matching Engine ✅
- Pluggable strategy interface (swap algorithms at runtime)
- GreedyStrategy (immediate, per-request scoring)
- BatchAuctionStrategy (periodic optimal assignment)
- Multi-dimensional scoring: price × speed × trust × load
- Consumer preference routing: cheapest / fastest / most_secure / balanced
- Full decision traces (every match shows scoring breakdown)

### Security & Privacy ✅
- E2E encryption (X25519 + XSalsa20-Poly1305, per-request forward secrecy)
- Coordinator cannot read prompts (blind relay in E2E mode)
- Apple Silicon hardening plan (PT_DENY_ATTACH + Hardened Runtime)
- Windows hardening module (SetProcessMitigationPolicy)
- OCIP confidence levels defined (L0-L4)

### Billing & Auth ✅
- Multi-tenant API keys (sk-ie-...)
- Per-request token billing with micro-USD ledger
- Provider earnings (90/10 split)
- SQLite persistence (survives restarts)
- Account balance tracking

### Model Identity ✅
- GGUF metadata auto-reading (name, arch, quantization, context length)
- SHA-256 file hash computation (for verification)
- HuggingFace model search via API
- Cross-reference: which HF models have providers on the exchange

### Dynamic Performance ✅
- TPS tracking with exponential moving average (EMA)
- Hardware lookup table for initial estimates
- Converges to observed reality after 3+ requests
- Anomaly detection (sudden performance drops)

### Observability ✅
- Consumer dashboard (order book, pricing, chat, preferences)
- Admin control plane (full system state, all accounts, decision traces)
- Model discovery (HF search + exchange availability)
- TPS performance table
- Health endpoint

---

## Next Steps (not yet built)

### Near-term (software, no special hardware)
1. **Provider reputation** — track success rate, latency, uptime; factor into scoring
2. **Request retry** — auto-retry on another provider if one fails mid-inference
3. **Rate limiting** — per-key token bucket
4. **Real token counting** — tiktoken for accurate billing
5. **Request queuing** — queue when busy instead of immediate 503
6. **Coordinator → HF hash verification** — verify provider's reported hash matches HF's published hash
7. **WebSocket real-time feed** — push events to dashboards instead of polling

### Medium-term (requires specific hardware/accounts)
8. **Apple Silicon hardened build** — compile llama.cpp with hardening, codesign, test on M1+
9. **Deploy coordinator to cloud** — Fly.io/Railway/ECS with TLS
10. **Stripe integration** — real deposits + provider payouts
11. **Remote provider demo** — ngrok or Tailscale tunnel, provider on different machine
12. **Pip-installable provider** — `pip install ie-provider && ie-provider start`

### Long-term (ecosystem)
13. **AMD SEV-SNP Level 3** — hardware-encrypted inference on Ryzen Pro
14. **React frontend** — proper SPA with TradingView charts, WebSocket real-time
15. **Federation** — multiple coordinators sharing provider fleet
16. **On-chain settlement** — optional crypto billing alongside Stripe

---

## Architecture Summary

```
Consumer → Coordinator → Provider
  HTTP       FastAPI       WebSocket → llama-cpp-python → Metal/CUDA GPU
  OpenAI     Matching      E2E Encryption
  SDK        Engine        Model Identity (GGUF metadata + SHA-256)
             Billing       TPS Tracking
             Auth          Hardening (macOS/Windows)
```

## File Map

```
inference_exchange/
├── coordinator/
│   ├── main.py              App + WebSocket hub
│   ├── api.py               All HTTP endpoints (OpenAI + exchange + admin)
│   ├── provider_hub.py      Provider connections + scoring
│   ├── store.py             SQLite persistence
│   ├── billing.py           Legacy in-memory billing
│   ├── auth.py              Legacy in-memory auth
│   ├── tps_tracker.py       Dynamic TPS measurement
│   ├── model_registry.py    HuggingFace model search + verification
│   ├── matching/            Pluggable matching engine
│   │   ├── strategy.py      GreedyStrategy + BatchAuctionStrategy
│   │   ├── engine.py        Orchestrator
│   │   └── models.py        Order/Offer types
│   └── static/
│       ├── index.html       Consumer exchange dashboard
│       └── admin.html       Admin control plane
├── provider/
│   ├── main.py              CLI entrypoint
│   ├── agent.py             WebSocket client + inference dispatch
│   ├── inference.py         llama-cpp-python wrapper
│   ├── model_identity.py    GGUF metadata reader + hash
│   └── hardened_client.py   Unix socket client (for hardened mode)
├── shared/
│   ├── protocol.py          OCIP message types
│   └── crypto.py            X25519 E2E encryption
├── config.py                Configuration
└── cli.py                   Model download tool

provider-hardened/
├── hardening.c/h            macOS hardening (PT_DENY_ATTACH + SIP)
├── hardening_windows.c      Windows hardening (mitigation policies)
├── entitlements.plist       macOS code signing config
├── build.sh                 Build + sign script
└── verify.sh                Hardening verification tests

docs/
├── architecture.md          System diagrams
├── requirements.md          Functional/non-functional requirements
├── apple-silicon-hardening.md  Full implementation plan for macOS
└── roadmap.md               This file

tests/
├── test_matching.py         Matching engine unit tests (13 tests)
├── test_preferences.py      Preference routing verification
├── test_integration.py      End-to-end integration test
├── simulate_exchange.py     Multi-buyer exchange simulation
└── load_test.py             Concurrent load testing
```
