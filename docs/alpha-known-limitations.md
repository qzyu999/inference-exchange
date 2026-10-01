# Alpha Known Limitations

Last updated: October 2026

This document lists what works, what doesn't, and what's planned for the Inference Exchange alpha release. If you hit something not listed here, file an issue.

## What Works

### Core inference pipeline
- Consumer sends request → coordinator matches → provider runs inference → response streams back
- OpenAI-compatible API (`/v1/chat/completions`) with streaming and non-streaming
- Standard OpenAI SDK works with `base_url` swap
- Single-model and multi-model routing

### Matching engine
- Multi-dimensional scoring: price, speed, trust level, load, reputation
- Consumer preferences: `cheapest`, `fastest`, `most_secure`, `balanced`
- Minimum trust level filtering (`ocip_min_confidence`)
- Maximum price constraint (`ocip_max_price`)
- Request queuing when all providers are busy (50 depth, 30s timeout)
- Decision traces for your own requests via `/v1/exchange/traces` (admins see all)

### Billing
- Per-token billing (input + output, separate rates)
- 90/10 provider/platform split
- $10 free credits on signup
- SQLite-persisted accounts, keys, and transactions
- Transaction history per consumer

### E2E encryption
- X25519 per-request forward secrecy (consumer → provider)
- Optional response encryption (provider → consumer, requires IE SDK)
- Coordinator is a blind relay when encryption is active

### Provider system
- WebSocket registration with capabilities advertisement
- Token-based provider authentication
- Model identity from GGUF metadata (name, architecture, quantization, context length)
- Model hash verification against HuggingFace
- Heartbeats and disconnect detection
- Reputation tracking (EMA-based success rate + latency)
- TPS measurement (EMA of observed throughput)

### Web UI
- Landing page with Three.js stellated octahedron scroll animation
- Chat page with streaming, model selection, preference controls, privacy selector
- Exchange page with model market cards, reference pricing, live trade feed
- Billing page with balance and transaction history
- API key management page
- GitHub sign-in (email/password in dev), server-side logout, API key revocation, account deletion

### Reference pricing
- Live price fetching from OpenRouter and Together AI
- Static prices for OpenAI, Anthropic, Google, Deepinfra, Groq, Fireworks
- Honest comparison (shows when IE is more expensive too)
- Same-model vs alternative-model comparison separation

## What Doesn't Work (Known Issues)

### Trust levels are self-reported
- A provider declares its own trust level at registration. The coordinator does not yet verify L2 evidence, and no provider can pass L3 (App Attest) admission yet.
- **Impact**: "Hardened" means the operator claims it. A malicious operator can claim L2 and see prompts. The API exposes this as `trust.basis: "self_reported"` and the UI labels it.
- **Plan**: Coordinator-assigned trust from evidence (#1, #19, #22, #25).

### Browser chat trusts the served JavaScript
- The web UI is served by the coordinator. A compromised coordinator could ship JS that reads prompts before encryption.
- **Impact**: The SDK path can be hardened against this; the browser path cannot yet.
- **Plan**: SRI, CSP, published bundle hashes, and a pinned client (#68).

### TLS only via the deploy stack
- `deploy/docker-compose.yml` terminates TLS with Caddy. Running the coordinator directly (`make dev`) is plain HTTP/WS.
- **Impact**: Only use the deploy stack on the public internet.

### No provider hardening in dev mode
- Providers run as plain Python processes (L0/L1 trust). The L2 hardened runtime exists (`provider-hardened/`) but isn't the default dev path.
- **Impact**: The default chat privacy filter (L2+) will reject unhardened providers. Set Privacy to "Any" in the chat UI for dev testing.
- **Plan**: Moved to Beta milestone (#3, #8). Hardening is opt-in for alpha.

### Provider state is ephemeral
- Live provider connections, reputation scores, and TPS measurements are in-memory. They reset when the coordinator restarts.
- **Impact**: Provider reputation starts fresh after every coordinator restart.
- **Plan**: Persist TPS and reputation to SQLite (#39).

### Single-process coordinator
- No horizontal scaling. One coordinator process handles all providers and consumers.
- **Impact**: Fine for alpha testing with a handful of providers. Won't handle hundreds.
- **Plan**: Beta/Future milestone.

### Price ceiling is output-only
- `ocip_max_price` filters on output price only. The chat UI's input/cache sliders are not sent.
- **Plan**: Three-tier ceilings (#52).

### Billing is post-pay
- The only pre-check is balance > 0, so a balance can go slightly negative. Cancelled streams are billed in full once the provider finishes; failed or timed-out requests are not billed.

### No context-length check
- Requests longer than the provider's context fail at the provider instead of being rejected up front (#32).

### Limited fallback routing
- If sending to a provider fails, there is one retry on another provider. A failure mid-stream is not retried.
- **Plan**: Fallback routing (#13, #26).

### Audit log is append-only file
- Hash-chained JSONL at `~/.inference-exchange/audit.jsonl`. No query interface, no rotation, no export.
- **Impact**: Grows unbounded. Useful for forensics but not for analytics.
- **Plan**: Future improvement.

### Web UI on older hardware
- The Three.js landing page requires WebGL. Older Intel Macs may not support it.
- **Impact**: Falls back to a static CSS animation — functional but less impressive.
- **Workaround**: Works fine on any machine with WebGL (most modern browsers).

## Not Planned for Alpha

These are explicitly deferred:

- App Attest provider admission (Beta: #19, #22)
- Provider attack tests — debugger, memory, /proc (Beta: #4, #5, #6)
- Confidential session handshake (Beta: #25)
- Hardware benchmark admission (Beta: #36)
- Electricity cost modeling (Future: #31)
- Cache-aware routing (Future: #33)
- Real payments and provider payouts (#44)
