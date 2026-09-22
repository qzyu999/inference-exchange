# Inference Exchange

A decentralized marketplace for AI inference. Providers contribute idle compute and set their own prices. Consumers get OpenAI-compatible inference with configurable privacy, routed by a matching engine that optimizes for price, speed, or security.

Built on the [Open Confidential Inference Protocol (OCIP)](https://github.com/qzyu999/ocip).

## Quick Start

**Prerequisites:** Python 3.11+, Node.js 18+, Git

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange

# Setup (creates venv, installs deps, downloads a small model)
make setup

# Terminal 1: Start coordinator + web UI
make dev

# Terminal 2: Start a local provider
make dev-provider
```

Open **http://localhost:3000** — you'll see the exchange dashboard. Go to **Chat** and send a message.

### Windows

```powershell
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
python -m inference_exchange download-model
cd web && npm install && cd ..

# Terminal 1: Coordinator
python -m inference_exchange.coordinator

# Terminal 2: Web UI
cd web && npm run dev

# Terminal 3: Provider
python -m inference_exchange.provider --name "local-dev" --price-output 0.15
```

## How It Works

```
Consumer (OpenAI SDK)  →  Coordinator (matching engine)  →  Provider (llama.cpp)
     "cheapest"              scores providers                 budget-mac wins
     "fastest"               scores providers                 gpu-beast wins
     "most_secure"           scores providers                 secure-vault wins
```

- **Consumers** send standard OpenAI API requests with optional routing preferences
- **Providers** connect via WebSocket, advertise models/prices/hardware/trust level
- **Matching engine** scores all eligible providers per-request on price, speed, trust, and load
- **E2E encryption** — prompts encrypted to the provider's X25519 key; coordinator can't read them
- **Per-token billing** — consumers pay per token, providers earn 90%, platform keeps 10%

## Multiple Providers

Start several providers with different profiles to see the matching engine in action:

```bash
# Cheap, slow, no isolation
make dev-provider ARGS="--name budget-mac --price-output 0.08 --trust open"

# Expensive, fast
make dev-provider ARGS="--name gpu-beast --price-output 0.30 --trust contained"
```

Switch the **Preference** dropdown in the chat — watch different providers win.

## Consumer Integration

Works with any OpenAI SDK. Change one line:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="sk-ie-..."  # from /keys page or auto-generated
)

response = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello!"}],
    extra_body={
        "ocip_preference": "cheapest",        # cheapest | fastest | most_secure | balanced
        "ocip_min_confidence": "hardened",     # open | contained | hardened | confidential
    }
)
```

## API Endpoints

```
POST /v1/chat/completions         — inference (streaming + non-streaming)
GET  /v1/models                   — available models

GET  /v1/exchange/providers       — connected providers
GET  /v1/exchange/pricing         — current market prices
GET  /v1/exchange/market          — model-centric view with reference pricing
GET  /v1/exchange/depth           — order book (capacity at each price level)
GET  /v1/exchange/reference-prices — competitor pricing from OpenRouter, Together, etc.
GET  /v1/exchange/traces          — recent matching decisions with full scoring
GET  /v1/exchange/telemetry       — engine metrics

GET  /v1/exchange/balance         — your balance
GET  /v1/exchange/history         — your transaction history
POST /v1/auth/keys                — create API key
GET  /v1/auth/me                  — your account info
```

## Development

```bash
make help            # list all commands
make setup           # full setup
make dev             # start coordinator + web UI
make dev-provider    # start a local provider
make test            # run tests
make smoke           # quick E2E smoke test
make lint            # run linter
make clean           # remove venv, caches, node_modules
```

## Architecture

```
inference_exchange/
├── coordinator/          # FastAPI coordinator service
│   ├── main.py           # App, WebSocket hub, lifespan
│   ├── routes_*.py       # API endpoints (inference, exchange, auth, admin)
│   ├── provider_hub.py   # Provider registry, scoring, routing
│   ├── matching/         # Pluggable matching engine (GreedyStrategy)
│   ├── store.py          # SQLite persistence
│   ├── price_collector.py # Reference pricing from external providers
│   └── event_bus.py      # Real-time WebSocket events
├── provider/             # Simple provider (dev/testing)
├── shared/               # OCIP protocol types + X25519 crypto
├── config.py             # Configuration
└── cli.py                # CLI tools (download-model, etc.)

ocip_agent/               # Production OCIP agent (E2E encryption, attestation)
provider-hardened/        # L2 hardening (PT_DENY_ATTACH, codesign)
web/                      # React + Three.js frontend
tests/                    # Test suite (290+ tests)
docs/                     # Design docs, threat model, architecture
```

## Status

Alpha. Working two-machine inference (M2 provider ↔ coordinator ↔ web UI), E2E encryption, per-token billing, real-time exchange dashboard, reference pricing. Not production-hardened.

## License

Apache 2.0
