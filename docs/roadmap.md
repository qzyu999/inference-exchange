# Inference Exchange -- Roadmap & Status

## Current State -- 307 tests, hardened E2E, cross-machine proven

### Core Infrastructure ✅
- Coordinator -- FastAPI, 5 route modules, SQLite persistence
- OCIP Agent -- two-process architecture (agent + hardened inference server)
- Matching engine -- formal GreedyStrategy wired into live routing
- Protocol -- OCIP wire format with versioning, REGISTERED confirmation
- Structured OCIP error types
- Audit log (append-only, hash-chained)

### Security & Privacy ✅
- E2E request encryption (X25519, per-request forward secrecy)
- E2E response encryption (consumer keypair via IE SDK)
- Hardened llama-server (PT_DENY_ATTACH + Hardened Runtime, verified M2 Max)
- Hardened agent binary (PyInstaller + codesign, onedir mode)
- Attestation with hardening evidence (SIP, runtime, binary hashes)
- Provider WebSocket auth (token-based)
- Model identity from GGUF metadata + SHA-256 hash verification vs HuggingFace
- OCIP confidence levels (L0-L3)
- Formal threat model (5 attack surfaces, 5 gaps -- 4 closed)

### Matching & Routing ✅
- GreedyStrategy + BatchAuctionStrategy (formal module)
- Multi-dimensional scoring: price, speed, trust, load
- Consumer preferences: cheapest / fastest / most_secure / balanced
- Reputation scaling (EMA, 50-100% score modifier)
- Session affinity (20% bonus, LRU-bounded)
- Request queuing (50 depth, 30s timeout, FIFO dispatch)
- Request retry on provider failure

### Billing & Economics ✅
- Per-token billing (input + output, proportional pricing)
- 90/10 provider/platform split
- Multi-tenant API keys (SHA-256 hashed, SQLite)
- Rate limiting (30 req/min token bucket)
- Financial invariants property-tested (1000 random events)

### React Frontend ✅ (8 pages)
- Landing -- privacy-first hero, trust levels, features, live pricing
- Exchange -- depth chart, provider ladder, trade ticker, live feed
- Chat -- streaming SSE, model/preference selectors, markdown, persistence
- Models -- HuggingFace search + exchange catalog with pricing
- Providers -- cards with trust badges, load bars, reputation, setup CTA
- Billing -- balance cards, transaction history, pricing explainer
- API Keys -- key management + quick start (curl, Python, TypeScript)
- Admin -- system state, TPS, reputation, decision traces, telemetry
- Apple-clean design (amber brand, rounded cards, frosted nav)
- IE favicon + proper meta tags

### Testing ✅
- 307 tests across 19 files
- GGUF metadata parser tests (model identity)
- Hash-chained audit log tests (tamper detection)
- Financial invariant property tests
- SQLite persistence tests
- Matching engine tests
- Crypto roundtrip + forward secrecy tests

### Documentation ✅ (16 docs)
- Architecture (current file map, request flow, security layers)
- Threat model (attack surfaces, gaps, risk matrix)
- Provider architecture (multi-engine, hardening levels, E2E design)
- E2E encryption status (both paths encrypted)
- System design (POC vs production deployment)
- M3 hardening guide (6 phases, tested)
- Billing/caching economics, consumer integration, OCIP agent architecture
- Platform hardening plans (macOS, Windows, Linux)
- Product spec, roadmap

---

## Completed Phases

### Phase 1: Core + Refactoring ✅
- Split api.py into 5 route modules
- SQLite persistence (replaces in-memory)
- OCIP spec alignment (protocol version, REGISTERED, structured errors)

### Phase 2: Security ✅
- E2E request encryption (X25519)
- E2E response encryption (consumer keypair)
- Hardened llama-server (PT_DENY_ATTACH + Hardened Runtime)
- Hardened agent binary (PyInstaller onedir + codesign)
- Provider WebSocket auth (token-based)
- Attestation with hardening evidence
- Model identity (GGUF metadata + SHA-256 vs HuggingFace)
- Formal threat model

### Phase 3: Matching Engine ✅
- Wired formal matching module into live routing
- Replaced inline scoring with GreedyStrategy
- Added reputation and session affinity to scoring

### Phase 4: React Frontend ✅
- 8-page SPA (Vite + React + TypeScript + Tailwind)
- Apple-clean redesign (amber brand, consistent cards)
- Chat persistence, typing indicator, auto-refocus

### Phase 5: Cross-Machine POC ✅
- Intel MBP (coordinator) <-> M2 Max (hardened provider) over WiFi
- Full E2E: encrypted prompt -> routing -> hardened inference -> encrypted response
- IE SDK verified (consumer-side decryption)

### Phase 6: Codebase Cleanup ✅
- Architecture doc rewritten
- Dead code removed (hardened_client.py)
- Dependency types fixed (protocol interfaces)
- Session affinity LRU-bounded
- /health API key gated
- Admin dashboard weights corrected
- 307 tests (17 new for model identity + audit log)

---

## Next Steps

### Pre-Deploy (code work, no infra needed)
1. **User accounts** (OAuth/email signup) -- consumer + provider identity
2. **Provider self-service** -- `ie-provider login` device-code flow
3. **Consumer SDK polish** -- retry, timeouts, async, error handling
4. **Multi-provider testing** -- 2+ providers with different models/prices

### Deploy
5. **Cloud coordinator** (Fly.io + TLS) -- public URL, anyone can test
6. **CDN for React SPA** (Cloudflare Pages) -- fast static hosting
7. **TLS everywhere** -- HTTPS/WSS, closes threat model GAP 2

### Post-Deploy (product growth)
8. **Stripe integration** -- real deposits + provider payouts
9. **Apple App Attest** -- hardware-backed attestation
10. **Multi-coordinator federation** -- HA, geographic routing

---

## Repos
- **inference-exchange**: https://github.com/qzyu999/inference-exchange (MIT)
- **ocip**: https://github.com/qzyu999/ocip (Apache 2.0)
