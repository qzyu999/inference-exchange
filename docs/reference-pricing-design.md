# Reference Pricing System — Design

Issue: #40

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Coordinator (FastAPI)                                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  PriceCollector (background task, runs in lifespan)           │  │
│  │                                                               │  │
│  │  Every 30 min:                                                │  │
│  │    for fetcher in fetchers:                                   │  │
│  │      prices = fetcher.fetch()    ← HTTP to external APIs     │  │
│  │      memory_cache.update(prices)                              │  │
│  │      store.snapshot(prices)      ← SQLite persistence        │  │
│  │                                                               │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ OpenRouter   │ │ Together     │ │ Direct API prices    │  │  │
│  │  │ Fetcher      │ │ Fetcher      │ │ (OpenAI, Anthropic,  │  │  │
│  │  │              │ │              │ │  Google, Deepinfra,   │  │  │
│  │  │ Public API   │ │ Public API   │ │  Groq, Fireworks)    │  │  │
│  │  │ /v1/models   │ │ /v1/models   │ │                      │  │  │
│  │  │ No auth      │ │ No auth      │ │  Versioned static    │  │  │
│  │  │ TTL: 30min   │ │ TTL: 30min   │ │  TTL: 24h            │  │  │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  In-Memory Cache (dict, keyed by source+model)                │  │
│  │                                                               │  │
│  │  {                                                            │  │
│  │    ("openrouter", "meta-llama/llama-3.1-8b"): PriceEntry,    │  │
│  │    ("together", "meta-llama/llama-3.1-8b"): PriceEntry,      │  │
│  │    ("openai", "gpt-4o-mini"): PriceEntry,                    │  │
│  │    ...                                                        │  │
│  │  }                                                            │  │
│  └──────────────┬────────────────────────────────────────────────┘  │
│                 │                                                    │
│        Read by  │  Written to                                        │
│                 │                                                    │
│  ┌──────────────▼────────────────────────────────────────────────┐  │
│  │  SQLite: reference_prices table                               │  │
│  │                                                               │  │
│  │  source | model_id | display_name | input | output | ctx | ts │  │
│  │  ─────────────────────────────────────────────────────────────│  │
│  │  "openrouter" | "meta-llama/..." | "Llama 3.1 8B" | 0.06 |...│  │
│  │  "together"   | "meta-llama/..." | "Llama 3.1 8B" | 0.10 |...│  │
│  │  "openai"     | "gpt-4o-mini"    | "GPT-4o Mini"  | 0.15 |...│  │
│  │                                                               │  │
│  │  Retention: INSERT new rows each fetch cycle.                 │  │
│  │  Old rows pruned to keep ≤ 90 days of history.                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  API Endpoints (routes_exchange.py)                           │  │
│  │                                                               │  │
│  │  GET /v1/exchange/reference-prices                            │  │
│  │    → Current prices from all sources, grouped by model family │  │
│  │    → Includes IE's own exchange prices for comparison         │  │
│  │    → Query params: ?model=llama&source=openrouter             │  │
│  │                                                               │  │
│  │  GET /v1/exchange/reference-prices/history                    │  │
│  │    → Daily price snapshots from SQLite for trend charts       │  │
│  │    → Query params: ?model=llama-3.1-8b&days=30               │  │
│  │                                                               │  │
│  │  GET /v1/exchange/market  (existing, enhanced)                │  │
│  │    → Already calls compute_savings() — will use new data      │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
Startup
  │
  ▼
PriceCollector.start()
  │
  ├─ Immediate first fetch (all sources in parallel)
  │    ├─ OpenRouterFetcher.fetch()  ──GET──▶ openrouter.ai/api/v1/models
  │    ├─ TogetherFetcher.fetch()    ──GET──▶ api.together.xyz/v1/models
  │    └─ DirectPriceFetcher.load()  ──read──▶ static pricing dict (versioned)
  │
  ├─ Normalize all to: { source, model_id, display_name, family, input_per_mtok, output_per_mtok, context_length }
  │
  ├─ Update in-memory cache
  │
  ├─ INSERT INTO reference_prices (one row per source+model)
  │
  └─ Schedule next fetch in 30 minutes
       │
       └─ (repeat)

Request: GET /v1/exchange/reference-prices?model=llama
  │
  ├─ Read from in-memory cache (fast, no DB hit)
  ├─ Filter by model family if ?model= provided
  ├─ Group by model family
  ├─ Inject IE exchange prices from ProviderHub
  └─ Return JSON

Request: GET /v1/exchange/reference-prices/history?model=llama-3.1-8b&days=30
  │
  ├─ SELECT from reference_prices WHERE model matches AND ts > (now - 30 days)
  ├─ GROUP BY date, source → one price point per source per day
  └─ Return time-series JSON
```

## Fetcher Design

Each source implements a simple interface:

```python
class PriceFetcher:
    source: str           # "openrouter", "together", "openai", etc.
    ttl: int              # seconds between fetches
    last_fetch: float     # timestamp of last successful fetch

    async def fetch(self) -> list[PriceEntry]:
        """Fetch current prices. Returns normalized PriceEntry list."""
        ...
```

### Source-specific notes

| Source | Method | Auth | TTL | Notes |
|--------|--------|------|-----|-------|
| OpenRouter | `GET /api/v1/models` | None | 30 min | ~300 models with pricing. Per-token → multiply by 1M for Mtok |
| Together | `GET /v1/models` | None (public listing) | 30 min | Pricing in per-token format |
| OpenAI | Static dict | N/A | 24h | Prices change rarely. Version-pin and update manually |
| Anthropic | Static dict | N/A | 24h | Same — update on release announcements |
| Google | Static dict | N/A | 24h | Gemini pricing from public docs |
| Deepinfra | Static dict | N/A | 24h | Public pricing page, update periodically |
| Groq | Static dict | N/A | 24h | Public pricing page |
| Fireworks | Static dict | N/A | 24h | Public pricing page |

**Why static for some**: OpenAI, Anthropic, and Google don't have public pricing APIs. Their prices change rarely (quarterly at most). Scraping is fragile and unnecessary. A versioned static dict with a clear `LAST_UPDATED` timestamp is honest and maintainable. The UI can show "Prices as of Sept 2026" for static sources.

### Model Family Matching

The key challenge: how to compare "meta-llama/Llama-3.1-8B-Instruct" on IE against "meta-llama/llama-3.1-8b-instruct" on OpenRouter against "Llama 3.1 8B" on Together. 

Strategy: extract a canonical family+size key from each model name and match on that. The existing `model_catalog.py` already has `parse_model_info()` which extracts family, size, variant. Use the same parser for reference model names.

```
"meta-llama/Llama-3.1-8B-Instruct"  → family="llama", size="8b", variant="instruct"
"meta-llama/llama-3.1-8b-instruct"  → family="llama", size="8b", variant="instruct"
"Llama 3.1 8B Instruct"             → family="llama", size="8b", variant="instruct"
```

Group key: `"llama-3.1-8b"` (family + version + size, drop variant for grouping).

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS reference_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,              -- 'openrouter', 'together', 'openai', etc.
    model_id TEXT NOT NULL,            -- source's native model ID
    display_name TEXT NOT NULL,        -- human-readable name
    family TEXT NOT NULL,              -- normalized family: 'llama', 'qwen', etc.
    family_key TEXT NOT NULL,          -- grouping key: 'llama-3.1-8b'
    input_per_mtok REAL NOT NULL,      -- $/Mtok input
    output_per_mtok REAL NOT NULL,     -- $/Mtok output
    context_length INTEGER DEFAULT 0,
    fetched_at REAL NOT NULL           -- unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_ref_family_key ON reference_prices(family_key, fetched_at);
CREATE INDEX IF NOT EXISTS idx_ref_source ON reference_prices(source, fetched_at);
```

Rows accumulate over time (one set per fetch cycle). Query latest with `GROUP BY source, model_id ORDER BY fetched_at DESC`. Prune rows older than 90 days on each fetch cycle.

## API Responses

### `GET /v1/exchange/reference-prices`

```json
{
  "models": [
    {
      "family_key": "llama-3.1-8b",
      "display_name": "Llama 3.1 8B",
      "prices": [
        {
          "source": "inference-exchange",
          "price_input": 0.04,
          "price_output": 0.08,
          "providers": 3,
          "trust_levels": ["hardened", "contained"],
          "note": "E2E encrypted"
        },
        {
          "source": "openrouter",
          "price_input": 0.06,
          "price_output": 0.06,
          "model_id": "meta-llama/llama-3.1-8b-instruct",
          "context_length": 131072
        },
        {
          "source": "together",
          "price_input": 0.10,
          "price_output": 0.10,
          "model_id": "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"
        }
      ],
      "cheapest_source": "inference-exchange",
      "ie_savings_vs_cheapest_alt_pct": 33
    }
  ],
  "sources": ["inference-exchange", "openrouter", "together", "openai", "anthropic", "google", "deepinfra", "groq", "fireworks"],
  "last_updated": {
    "openrouter": "2026-09-20T10:30:00Z",
    "together": "2026-09-20T10:30:00Z",
    "openai": "2026-09-01T00:00:00Z",
    "anthropic": "2026-09-01T00:00:00Z"
  }
}
```

### `GET /v1/exchange/reference-prices/history?family_key=llama-3.1-8b&days=30`

```json
{
  "family_key": "llama-3.1-8b",
  "days": 30,
  "history": [
    {
      "date": "2026-09-20",
      "prices": {
        "openrouter": {"input": 0.06, "output": 0.06},
        "together": {"input": 0.10, "output": 0.10},
        "inference-exchange": {"input": 0.04, "output": 0.08}
      }
    },
    {
      "date": "2026-09-19",
      "prices": { ... }
    }
  ]
}
```

## Implementation Plan

### Phase 1: Fetcher framework + SQLite persistence
1. Define `PriceEntry` dataclass and `PriceFetcher` base
2. Refactor existing OpenRouter fetcher into the new interface
3. Add Together fetcher (public API)
4. Expand the static dict to cover OpenAI, Anthropic, Google, Deepinfra, Groq, Fireworks with `LAST_UPDATED` timestamps
5. Add `reference_prices` table to store.py schema
6. Build `PriceCollector` background task (asyncio, registered in lifespan)
7. First fetch on startup, then every 30 min

### Phase 2: API endpoints
1. `GET /v1/exchange/reference-prices` — current prices grouped by family
2. `GET /v1/exchange/reference-prices/history` — time-series from SQLite
3. Enhance existing `compute_savings()` to use the new fetcher data instead of the old function

### Phase 3: Frontend integration
1. Add reference pricing table to the Exchange page
2. Sparkline price history charts per model
3. "X% cheaper than Y" badges on model cards

## Open Questions (Resolved)

1. **Rate limiting**: Yes, add jitter. The collector uses ±10% jitter on the 30-min interval to avoid thundering herd against external APIs.
2. **Closed-source comparison**: Yes, separate them. The `comparison_type` field distinguishes `"same_model"` (open-weight providers hosting the same model) from `"alternative"` (closed-source APIs like OpenAI/Anthropic/Google). The UI should display these in separate sections — "Same model elsewhere" vs "Alternative models".
3. **Quantization context**: Yes, flag it. The `quantization` field is included in reference price entries when available. The UI should show a note like "Q4_K_M" vs "FP16" when comparing providers with different quantizations for the same model.
