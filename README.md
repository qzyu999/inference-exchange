# Inference Exchange

A decentralized marketplace for AI inference. Providers contribute idle compute and set their own prices. Consumers get OpenAI-compatible inference with configurable privacy, routed by a matching engine that optimizes for price, speed, or security based on consumer preference.

Built on the [Open Confidential Inference Protocol (OCIP)](https://github.com/qzyu999/ocip).

## What It Does

```
Consumer (OpenAI SDK)  →  Coordinator (matching engine)  →  Provider (llama.cpp)
     "cheapest"              scores 3 providers               budget-mac wins
     "fastest"               scores 3 providers               gpu-beast wins  
     "most_secure"           scores 3 providers               secure-vault wins
```

- **Providers** connect over WebSocket, advertise models/prices/hardware/trust level
- **Consumers** send standard OpenAI API requests with optional preference hints
- **Matching engine** scores all eligible providers and picks the best one per-request
- **E2E encryption** — prompts are encrypted to the provider's X25519 key (coordinator can't read them)
- **Per-request billing** — consumers pay per token, providers earn 90%, platform keeps 10%
- **Multi-tenant API keys** — each consumer has isolated balance and usage tracking
- **SQLite persistence** — keys, balances, and billing survive restarts

## Try It (5 minutes)

```bash
# Clone and setup
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
python -m venv .venv && .venv\Scripts\activate   # Windows
# source .venv/bin/activate                      # macOS/Linux
pip install -e .
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

# Download a small model (~400MB)
python -m inference_exchange download-model

# Terminal 1: Start coordinator
python -m inference_exchange.coordinator

# Terminal 2: Start a provider
python -m inference_exchange.provider --name "my-node" --price-output 0.15

# Terminal 3: Send a request
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
```

Open `http://localhost:8000` for the exchange dashboard, `http://localhost:8000/admin.html` for the admin control plane.

## Multiple Providers (see the matching in action)

```bash
# Cheap, slow, no isolation
python -m inference_exchange.provider --name "budget-mac" --price-output 0.08 --trust open --tps 25

# Expensive, fast, container-isolated
python -m inference_exchange.provider --name "gpu-beast" --price-output 0.30 --trust contained --tps 120

# Premium, hardware-encrypted (SEV-SNP)
python -m inference_exchange.provider --name "secure-vault" --price-output 0.50 --trust confidential --tps 60
```

Then switch the preference dropdown in the dashboard — watch different providers win.

## Consumer Preferences (OCIP routing)

Add `ocip_preference` to your request body to control routing:

```json
{
  "model": "default",
  "messages": [{"role": "user", "content": "Hello"}],
  "ocip_preference": "cheapest",
  "ocip_min_confidence": "contained",
  "ocip_max_price": 0.30
}
```

| Preference | Optimizes for |
|---|---|
| `balanced` | Weighted mix of all factors (default) |
| `cheapest` | Lowest price provider |
| `fastest` | Highest throughput provider |
| `most_secure` | Highest trust level provider |

## API (OpenAI-compatible)

```
POST /v1/chat/completions    — inference (streaming + non-streaming)
GET  /v1/models              — available models
POST /v1/auth/keys           — create API key
GET  /v1/auth/me             — your account info
GET  /v1/exchange/providers  — connected providers
GET  /v1/exchange/pricing    — current market prices
GET  /v1/exchange/depth      — order book (capacity at each price level)
GET  /v1/exchange/balance    — your balance
GET  /v1/exchange/telemetry  — engine metrics
GET  /v1/exchange/traces     — recent matching decisions with full scoring
GET  /v1/admin/state         — full system state (admin)
```

Standard OpenAI SDK works:
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8000/v1", api_key="sk-ie-...")
```

## Architecture

```
inference_exchange/
├── coordinator/              # FastAPI service
│   ├── main.py               # App setup, WebSocket hub, static serving
│   ├── api.py                # Consumer API + exchange endpoints
│   ├── provider_hub.py       # WebSocket connection manager + scoring
│   ├── store.py              # SQLite persistence (keys, billing, accounts)
│   ├── billing.py            # In-memory billing (legacy, kept for reference)
│   ├── auth.py               # In-memory auth (legacy, kept for reference)
│   ├── matching/             # Pluggable matching engine
│   │   ├── strategy.py       # GreedyStrategy + BatchAuctionStrategy
│   │   ├── engine.py         # Orchestrator (immediate or periodic matching)
│   │   └── models.py         # Formal order/offer types
│   └── static/               # Dashboard HTML
├── provider/                 # What runs on each provider machine
│   ├── agent.py              # WebSocket client + inference dispatch
│   ├── inference.py          # llama-cpp-python wrapper
│   └── main.py               # CLI entrypoint with pricing/trust flags
├── shared/                   # Protocol types + crypto
│   ├── protocol.py           # OCIP wire message types
│   └── crypto.py             # X25519 E2E encryption (NaCl Box)
└── config.py                 # Configuration
```

## Key Design Decisions

- **Matching is pluggable** — swap `GreedyStrategy` for `BatchAuctionStrategy` (or your own) at runtime
- **Providers connect outbound** — works behind NAT, no port forwarding needed
- **E2E encryption uses ephemeral keys** — forward secrecy, coordinator is a blind relay
- **Scoring is multi-dimensional** — price, speed, trust, load — weighted by consumer preference
- **Protocol is open** — see [OCIP spec](https://github.com/qzyu999/ocip) for the full wire format

## Status

Working proof-of-concept. Local-only, in-memory provider state (reconnects on restart), SQLite for durable data. Not production-hardened yet.

## License

MIT

