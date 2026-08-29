# Inference Exchange — Roadmap & Status

## Current State (what's built and working)

### Core Infrastructure ✅
- **Coordinator** — FastAPI, WebSocket provider hub, request routing
- **Provider Agent** — WebSocket client, inference via llama-cpp-python, auto-reconnect
- **OCIP Agent** — Two-process architecture (agent + isolated inference server)
- **Protocol** — OCIP wire format (JSON over WebSocket/HTTP+SSE)
- **Persistence** — SQLite for accounts, API keys, billing (survives restarts)

### Matching Engine ✅
- Pluggable strategy interface (swap algorithms at runtime)
- GreedyStrategy (immediate, per-request scoring)
- BatchAuctionStrategy (periodic optimal assignment)
- Multi-dimensional scoring: price × speed × trust × load × reputation
- Consumer preference routing: cheapest / fastest / most_secure / balanced
- Full decision traces (every match shows scoring breakdown)
- **Session affinity** — repeat conversations route to same provider (cache benefit)
- **Reputation-weighted routing** — bad providers naturally deprioritized

### Security & Privacy ✅
- E2E encryption (X25519 + XSalsa20-Poly1305, per-request forward secrecy)
- Coordinator cannot read prompts (blind relay in E2E mode)
- Two-process architecture proven (agent decrypts → forwards to isolated server)
- Hardening implementation plans for all platforms:
  - Apple Silicon: PT_DENY_ATTACH + Hardened Runtime + Metal GPU
  - Windows: Hyper-V + GPU-P (Level 2) or SEV-SNP (Level 3)
  - Linux: KVM + VFIO GPU passthrough (Level 2) or SEV-SNP (Level 3)
- OCIP confidence levels defined (L0-L4)
- Windows hardening C module written (SetProcessMitigationPolicy)
- macOS hardening C module written (PT_DENY_ATTACH + SIP check)

### Billing & Auth ✅
- Multi-tenant API keys (sk-ie-...)
- Per-request token billing (input + output, proportional)
- Proper token estimation (~4 chars/token + overhead)
- Provider earnings (90/10 split)
- SQLite persistence (survives restarts)
- Account balance tracking
- No flat minimum (proportional billing, rate limiting for spam)

### Model Identity ✅
- GGUF metadata auto-reading (name, arch, quantization, context length)
- SHA-256 file hash computation (verified against HuggingFace)
- HuggingFace model search via API (live search from coordinator)
- Cross-reference: which HF models have providers on the exchange
- Model identity reported by provider on registration

### Dynamic Performance ✅
- TPS tracking with exponential moving average (EMA)
- Hardware lookup table for initial estimates (Apple, NVIDIA, AMD)
- Converges to observed reality after 3+ requests
- Anomaly detection (sudden performance drops)
- Per (provider, model) tracking

### Provider Reputation ✅
- Success/failure/timeout tracking with EMA
- Composite score (70% success rate + 30% latency)
- Degraded flag for poorly-performing providers
- Factors into routing (50-100% score multiplier)
- Recent outcome history for debugging

### Session Affinity ✅
- Session ID in request routes to same provider
- Enables KV cache reuse across conversation turns
- Falls back to normal routing if provider unavailable
- Coordinator tracks session→provider mapping

### Observability ✅
- Consumer dashboard (order book, pricing, chat, preferences, model search)
- Admin control plane (full system state, accounts, decision traces, TPS table)
- Model discovery (HF search + exchange availability)
- TPS performance monitoring
- Health endpoint

### OCIP Agent (Two-Process Architecture) ✅
- Agent manages inference server lifecycle (start/monitor/restart)
- Auto-detects model from GGUF files
- True async streaming (per-token relay)
- Cancellation propagation (consumer disconnect → kill task)
- Health monitoring with exponential backoff restart
- One command starts everything

### Documentation ✅
- OCIP Protocol Spec (7 documents in /ocip/ repo)
- Apple Silicon hardening plan
- Windows hardening plan
- Linux hardening plan
- OCIP agent architecture (diagrams, flows, recovery)
- Billing & caching formal analysis (prefill/decode economics, cache reliability, all edge cases)
- This roadmap

---

## Next Steps (not yet built)

### Near-term (software, no special hardware needed)
1. ~~Proper token counting~~ ✅ Done
2. ~~Session affinity~~ ✅ Done
3. ~~Provider reputation~~ ✅ Done
4. ~~Request retry on failure~~ ✅ Done
5. ~~Rate limiting~~ ✅ Done (30 req/min per key, token bucket)
6. ~~OpenAI SDK compatibility test~~ ✅ Done (streaming + non-streaming + models)
7. **Coordinator → HF hash verification** — verify provider's reported hash matches HF published hash
8. **WebSocket real-time feed** — push events to dashboards instead of polling
9. **React frontend** — proper SPA with real-time charting
10. **Model catalog with filtering** — search by family, size, quantization, with availability overlay

### Medium-term (requires specific hardware/accounts)
11. **Apple Silicon hardened build** — compile llama.cpp with hardening, codesign, test on M1+
12. **Deploy coordinator to cloud** — Fly.io/Railway/ECS with TLS
13. **Stripe integration** — real deposits + provider payouts
14. **Remote provider demo** — ngrok/Tailscale tunnel, provider on different machine
15. **Pip-installable provider** — `pip install ie-provider && ie-provider start`

### Long-term (ecosystem)
16. **AMD SEV-SNP Level 3** — hardware-encrypted inference on Ryzen Pro
17. **Linux KVM + VFIO** — full GPU passthrough with hypervisor isolation
18. **Federation** — multiple coordinators sharing provider fleet
19. **On-chain settlement** — optional crypto billing alongside Stripe
20. **NVIDIA Confidential Computing** — Level 4 when consumer GPUs support it

---

## File Map

```
inference_exchange/
├── coordinator/
│   ├── main.py              App + WebSocket hub + lifecycle management
│   ├── api.py               All HTTP endpoints (OpenAI + exchange + admin)
│   ├── provider_hub.py      Provider connections + scoring + session affinity
│   ├── store.py             SQLite persistence (keys, billing, accounts)
│   ├── billing.py           Legacy in-memory billing
│   ├── auth.py              Legacy in-memory auth
│   ├── tps_tracker.py       Dynamic TPS measurement (EMA)
│   ├── reputation.py        Provider reputation (success/fail/timeout EMA)
│   ├── rate_limiter.py      Per-consumer token bucket rate limiting
│   ├── model_registry.py    HuggingFace model search + hash verification
│   ├── matching/            Pluggable matching engine
│   │   ├── strategy.py      GreedyStrategy + BatchAuctionStrategy
│   │   ├── engine.py        Orchestrator
│   │   └── models.py        Order/Offer types
│   └── static/
│       ├── index.html       Consumer exchange dashboard
│       └── admin.html       Admin control plane
├── provider/
│   ├── main.py              CLI entrypoint (with --models, --trust, --tps flags)
│   ├── agent.py             WebSocket client + inference dispatch
│   ├── inference.py         llama-cpp-python wrapper
│   ├── model_identity.py    GGUF metadata reader + SHA-256 hash
│   └── hardened_client.py   Unix socket client (for hardened mode)
├── shared/
│   ├── protocol.py          OCIP message types
│   └── crypto.py            X25519 E2E encryption
├── config.py                Configuration
└── cli.py                   Model download tool

ocip_agent/
├── __init__.py              Package description
└── agent.py                 Production agent: lifecycle, encryption, streaming, recovery

ocip_server/
├── __init__.py              Package description
└── server.py                Isolated inference: model loading, identity, completions API

provider-hardened/
├── hardening.c/h            macOS hardening (PT_DENY_ATTACH + SIP)
├── hardening_windows.c      Windows hardening (mitigation policies)
├── entitlements.plist       macOS code signing config
├── build.sh                 Build + sign script (macOS)
└── verify.sh                Hardening verification tests

docs/
├── roadmap.md               This file — status + next steps
├── architecture.md          System diagrams
├── requirements.md          Functional/non-functional requirements
├── ocip-agent-architecture.md  Two-process design (diagrams, flows, recovery)
├── billing-and-caching.md   Token economics, caching, formal analysis
├── apple-silicon-hardening.md  macOS Level 2 implementation plan
├── windows-hardening.md     Windows Tier A/B/C implementation plans
└── linux-hardening.md       Linux VFIO/SEV-SNP/Firecracker plans

tests/
├── test_matching.py         Matching engine unit tests (13 tests)
├── test_preferences.py      Preference routing verification
├── test_integration.py      End-to-end integration test
├── test_openai_sdk.py       Official OpenAI SDK compatibility proof
├── simulate_exchange.py     Multi-buyer exchange simulation
└── load_test.py             Concurrent load testing

web/                         React frontend scaffold (Vite + TypeScript)
```

---

## Repos

- **inference-exchange**: https://github.com/qzyu999/inference-exchange (MIT)
- **ocip**: https://github.com/qzyu999/ocip (Apache 2.0)
