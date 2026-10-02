# Inference Exchange — Requirements

## Overview

A decentralized marketplace where providers contribute idle compute for AI inference
and consumers get OpenAI-compatible inference at market prices, with configurable
privacy guarantees via the OCIP protocol.

---

## Functional Requirements

### FR-1: Consumer API (OpenAI-compatible)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-1.1 | `POST /v1/chat/completions` with streaming (SSE) | P0 | ✅ Done |
| FR-1.2 | `POST /v1/chat/completions` non-streaming | P0 | ✅ Done |
| FR-1.3 | `GET /v1/models` — list available models | P0 | ✅ Done |
| FR-1.4 | API key authentication | P1 | Todo |
| FR-1.5 | `POST /v1/completions` — legacy text completions | P2 | Todo |
| FR-1.6 | Tool/function calling support | P2 | Todo |
| FR-1.7 | Vision/multimodal input | P3 | Todo |

### FR-2: Provider Connection

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-2.1 | Provider connects to coordinator via outbound WebSocket | P0 | ✅ Done |
| FR-2.2 | Provider registers with capabilities (models, hardware) | P0 | ✅ Done |
| FR-2.3 | Provider sends periodic heartbeats | P0 | ✅ Done |
| FR-2.4 | Provider receives inference requests and streams tokens back | P0 | ✅ Done |
| FR-2.5 | Provider auto-reconnects on disconnect | P0 | ✅ Done |
| FR-2.6 | Request cancellation propagation | P1 | Todo |
| FR-2.7 | Multiple concurrent requests per provider | P1 | ✅ Done |

### FR-3: Request Routing

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-3.1 | Route to any provider that has the requested model | P0 | ✅ Done |
| FR-3.2 | Load-aware routing (prefer less loaded providers) | P0 | ✅ Done |
| FR-3.3 | Consumer can specify minimum trust level | P1 | Todo |
| FR-3.4 | Consumer can specify max price | P2 | Todo |
| FR-3.5 | Queue requests when no provider immediately available | P1 | Todo |
| FR-3.6 | Request timeout (120s default) | P1 | Todo |

### FR-4: Model Management

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-4.1 | CLI to download GGUF models from HuggingFace | P0 | ✅ Done |
| FR-4.2 | Auto-detect locally available models | P0 | ✅ Done |
| FR-4.3 | Model registry (coordinator knows all available models) | P1 | Todo |
| FR-4.4 | Model integrity verification (SHA-256 hash check) | P2 | Todo |

### FR-5: Billing & Pricing

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-5.1 | Provider sets price per million tokens | P2 | Todo |
| FR-5.2 | Consumer account balance (deposit via Stripe) | P2 | Todo |
| FR-5.3 | Per-request metering (token counting) | P2 | Todo |
| FR-5.4 | Provider payout ledger | P3 | Todo |
| FR-5.5 | Self-route (own provider = free) | P2 | Todo |

### FR-6: OCIP Trust & Attestation

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-6.1 | Provider reports trust level (open/contained/hardened/confidential) | P1 | Partial (field exists) |
| FR-6.2 | Container isolation mode (provider runs in Docker) | P1 | Todo |
| FR-6.3 | Attestation challenge-response from coordinator | P2 | Todo |
| FR-6.4 | E2E encryption (coordinator → provider, per-request keys) | P2 | Todo |
| FR-6.5 | MicroVM isolation mode | P3 | Todo |
| FR-6.6 | Hardware TEE attestation (AMD SEV-SNP) | P3 | Todo |

### FR-7: Web UI

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-7.1 | Chat interface (streaming) | P2 | Todo |
| FR-7.2 | Provider dashboard (connected providers, models, stats) | P2 | Todo |
| FR-7.3 | Account management (API keys, billing) | P3 | Todo |

---

## Non-Functional Requirements

### NFR-1: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1.1 | Time-to-first-token (coordinator overhead) | < 100ms |
| NFR-1.2 | Token relay latency (coordinator passthrough) | < 10ms per token |
| NFR-1.3 | Concurrent consumer requests (single coordinator) | ≥ 100 |
| NFR-1.4 | Concurrent provider connections | ≥ 1000 |
| NFR-1.5 | Provider model load time | Acceptable (10-60s for cold start) |

### NFR-2: Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.1 | Provider disconnect doesn't crash coordinator | Must handle gracefully |
| NFR-2.2 | Provider reconnect after network interruption | Auto-reconnect with backoff |
| NFR-2.3 | Request fails cleanly if no provider available | 503 with clear message |
| NFR-2.4 | No data loss on coordinator restart | Persist state to DB (P2) |

### NFR-3: Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-3.1 | API key auth for consumers | P1 |
| NFR-3.2 | Provider identity verification | P2 (attestation) |
| NFR-3.3 | E2E encryption (prompt content) | P2 |
| NFR-3.4 | No plaintext prompts in logs | P0 (immediate) |
| NFR-3.5 | Rate limiting per consumer | P1 |

### NFR-4: Operability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-4.1 | Single-command coordinator startup | ✅ Done |
| NFR-4.2 | Single-command provider startup | ✅ Done |
| NFR-4.3 | Works on Windows without compilation | ✅ (llama-cpp-python wheels) |
| NFR-4.4 | Works on macOS (Apple Silicon) | Should work (untested) |
| NFR-4.5 | Works on Linux | Should work (untested) |
| NFR-4.6 | Health check endpoint | ✅ Done |

### NFR-5: Developer Experience

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-5.1 | Full local dev (no cloud dependency) | ✅ Done |
| NFR-5.2 | Standard OpenAI SDK works as client | ✅ Done |
| NFR-5.3 | < 5 minutes from clone to working demo | Target |
| NFR-5.4 | Clear error messages (especially model setup) | ✅ Done |

---

## Constraints

- **Python 3.11+** — coordinator and provider
- **llama-cpp-python** — inference engine (pre-built wheels for all platforms)
- **No cloud dependency** — runs entirely locally for development
- **OpenAI API compatibility** — consumers use standard SDKs
- **OCIP protocol** — wire format between coordinator and provider follows OCIP spec

---

## Milestones

### M0: Local Demo (current)
- [x] Coordinator runs, accepts connections
- [x] Provider loads model, connects, serves requests
- [x] Consumer can stream chat completions via curl/SDK
- [x] Model download CLI

### M1: Multi-Provider
- [ ] Multiple providers connect simultaneously
- [ ] Routing picks best provider (load + speed)
- [ ] Provider disconnect handled gracefully
- [ ] Basic consumer auth (API keys)

### M2: Trust & Privacy
- [ ] OCIP trust levels reported and enforced
- [ ] E2E encryption (X25519 per-request)
- [ ] Container isolation mode for providers
- [ ] Consumer can request minimum trust level

### M3: Marketplace
- [ ] Provider-set pricing
- [ ] Consumer billing (Stripe deposits)
- [ ] Token metering and accounting
- [ ] Web UI (chat + dashboard)

### M4: Production
- [ ] Deploy coordinator to AWS (ECS + RDS + Redis)
- [ ] Provider installer (pip install + one-command start)
- [ ] MicroVM isolation option
- [ ] Reputation system
