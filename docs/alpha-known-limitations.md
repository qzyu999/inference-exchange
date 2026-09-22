# Alpha Known Limitations

Last updated: September 2026

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
- Full decision traces available via `/v1/exchange/traces`

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
- Login/signup with JWT sessions

### Reference pricing
- Live price fetching from OpenRouter and Together AI
- Static prices for OpenAI, Anthropic, Google, Deepinfra, Groq, Fireworks
- Honest comparison (shows when IE is more expensive too)
- Same-model vs alternative-model comparison separation

## What Doesn't Work (Known Issues)

### No TLS
- All communication is plaintext HTTP/WS. E2E encryption protects prompt content but metadata (which model, token counts, billing) is visible on the wire.
- **Impact**: Fine for LAN testing. Not safe for public internet use.
- **Plan**: Add TLS termination (nginx/caddy) for cloud deployment (#34 Topology 3).

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

### Pricing comparison is output-only
- Reference pricing comparison only looks at output token price, not input or cache pricing.
- **Impact**: Comparisons can be misleading for workloads with heavy input (long contexts).
- **Plan**: Full input/output/cache comparison (#42).

### No cache pricing
- The OCIP protocol doesn't include cache token pricing. Providers can't advertise discounts for KV cache hits.
- **Impact**: No session-affinity pricing benefit. Each request is priced the same regardless of cache state.
- **Plan**: Add cache pricing to protocol and billing (#42, #30).

### Limited model metadata
- `ProviderCapabilities` doesn't include context length, function calling, vision support, or JSON mode.
- **Impact**: Consumers can't filter by capability. All models look the same in terms of features.
- **Plan**: Extend capabilities (#43).

### No fallback routing
- If the selected provider fails mid-request, the request fails. No automatic retry to another provider.
- **Impact**: Occasional failures when providers disconnect or error during inference.
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
- Docker/cloud deployment automation (later in #34)
