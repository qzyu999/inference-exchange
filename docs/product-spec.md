# Product Specification — Inference Exchange Web Console

## Overview

One web application (`console.inference.exchange`) serving both consumers
and providers. Same login, different views based on what you do.

## User Personas

### Consumer (buys inference)
- Developer building an app that needs LLM inference
- Signs up, gets API key, deposits credits
- Browses models, sends requests, tracks spending
- Cares about: price, speed, model selection, privacy level

### Provider (sells compute)
- Person with an idle Mac/PC who wants to earn money
- Installs the OCIP agent, links to their account
- Monitors earnings, reputation, node health
- Cares about: earnings, uptime, utilization, getting more requests

### Admin (operates the exchange)
- Internal operator
- Monitors system health, resolves disputes, manages the fleet
- Cares about: total volume, provider quality, system errors

## Routes / Pages

```
/                       → Landing page (public)
/login                  → Auth (email/OAuth)
/chat                   → Chat interface (consumer)
/models                 → Browse available models (public)
/billing                → Balance, usage, deposit (consumer)
/keys                   → API key management (consumer)
/providers              → My provider nodes (provider)
/providers/setup        → Setup guide: install agent, link account (provider)
/exchange               → Live exchange view (public): providers, pricing, depth
/admin                  → Admin ops dashboard (internal)
```

## Page Specifications

### Landing `/`

Public page. No login required.

Content:
- What Inference Exchange is (one sentence)
- Live stats: providers online, models available, requests served, volume
- Price comparison vs OpenAI/Anthropic
- "Start using" (consumer CTA) → sign up
- "Start earning" (provider CTA) → setup guide

Data source: `GET /v1/exchange/stats`, `GET /v1/exchange/pricing`

### Chat `/chat`

Requires login. Consumer sends inference requests via a chat UI.

Features:
- Model selector dropdown (from `/v1/models`)
- Preference selector: ⚖️ balanced / 💰 cheapest / ⚡ fastest / 🔒 most secure
- Min trust level selector
- Max price input
- Streaming chat with SSE
- Shows per-message cost, provider used, encryption status
- Conversation history (local storage)

Data source: `POST /v1/chat/completions` (streaming SSE)

### Models `/models`

Public. Browse available models on the exchange.

Features:
- Search (queries HuggingFace + shows exchange availability)
- Filter by: family (llama, qwen, mistral), size (7B, 13B, 70B), quantization
- For each model: providers available, cheapest price, avg speed
- Click model → detailed view (providers serving it, price comparison)

Data source: `GET /v1/exchange/models/search?q=...`, `GET /v1/exchange/providers`

### Billing `/billing`

Requires login. Consumer financial view.

Features:
- Current balance (prominently displayed)
- Deposit button (→ Stripe Checkout, future)
- Usage graph (tokens/day over last 30 days)
- Transaction history (scrollable table)
- Cost breakdown by model

Data source: `GET /v1/exchange/balance`, `GET /v1/exchange/history`

### API Keys `/keys`

Requires login. Consumer key management.

Features:
- List existing keys (name, created, last used, requests)
- Create new key (name input → shows key once → copy button)
- Delete key
- Key usage stats

Data source: `GET /v1/auth/keys`, `POST /v1/auth/keys`

### My Providers `/providers`

Requires login. Provider node management.

Features:
- List of provider's connected nodes:
  - Name, hardware, model loaded
  - Status: 🟢 online / 🔴 offline / 🟡 degraded
  - Trust level badge
  - Live stats: requests served, tokens generated, earnings
  - TPS performance (observed vs estimated)
  - Reputation score + trend
  - Attestation status (last check, pass/fail)
  - Uptime
- Total earnings (today / week / all time)
- Earnings graph over time

Data source: `GET /v1/exchange/providers` (filtered by user), `GET /v1/exchange/reputation`, `GET /v1/exchange/tps`

Note: Currently providers aren't linked to user accounts. Need to add
`owner_id` to provider registration so the coordinator knows which
providers belong to which user. This is done via `ie-provider login`
which links the provider to the user's account.

### Provider Setup `/providers/setup`

Public (with login prompt). Step-by-step setup guide.

```
Step 1: Install the OCIP agent
  pip install ie-provider

Step 2: Download a model
  ie-provider download-model llama-3.1-8b

Step 3: Link your account
  ie-provider login
  → Opens browser → authorize → linked

Step 4: Start earning
  ie-provider start
  → Your node appears on this page
```

### Exchange `/exchange`

Public. The "trading floor" view.

Features:
- Order book / depth chart (provider capacity at each price level)
- Live provider table (all connected providers: name, model, price, speed, trust, load)
- Recent matches feed (real-time via WebSocket `/ws/events`)
- Market stats (total volume, requests, providers)
- Pricing by model

Data source: `GET /v1/exchange/depth`, `GET /v1/exchange/providers`,
`WS /ws/events`, `GET /v1/exchange/stats`

### Admin `/admin`

Internal. Full system view (existing admin dashboard, rebuilt in React).

Features:
- System components status
- All accounts with balances
- All API keys
- Provider fleet (full internal state)
- Matching engine config + decision traces
- Billing ledger
- Protocol/wire stats
- TPS performance table
- Real-time event feed

Data source: `GET /v1/admin/state`, `GET /v1/exchange/tps`,
`GET /v1/exchange/traces`, `WS /ws/events`

## Tech Stack

```
React 18 + TypeScript
Vite (build tool)
Tailwind CSS (styling)
React Router (routing)
SWR or TanStack Query (data fetching)
Recharts (charts/graphs)
WebSocket (real-time events from /ws/events)
```

## API Endpoints Used

| Endpoint | Used By |
|----------|---------|
| `GET /health` | Landing, all pages (connection check) |
| `GET /v1/models` | Chat, Models |
| `POST /v1/chat/completions` | Chat |
| `GET /v1/exchange/stats` | Landing, Exchange |
| `GET /v1/exchange/providers` | Exchange, Providers |
| `GET /v1/exchange/pricing` | Landing, Models |
| `GET /v1/exchange/depth` | Exchange |
| `GET /v1/exchange/balance` | Billing |
| `GET /v1/exchange/history` | Billing |
| `GET /v1/exchange/traces` | Admin |
| `GET /v1/exchange/tps` | Admin, Providers |
| `GET /v1/exchange/reputation` | Providers, Admin |
| `GET /v1/exchange/events/recent` | Exchange (catch-up) |
| `GET /v1/exchange/models/search?q=` | Models |
| `GET /v1/auth/keys` | Keys |
| `POST /v1/auth/keys` | Keys |
| `GET /v1/auth/me` | All (user identity) |
| `GET /v1/admin/state` | Admin |
| `WS /ws/events` | Exchange, Admin (real-time) |

## Missing Backend Features (Needed for Full Product)

1. **Provider → User linking** — providers need an `owner_id` so `/providers`
   page can filter "my nodes." Requires `ie-provider login` flow (RFC 8628
   device code or browser OAuth redirect).

2. **User accounts** — currently API keys only. Need proper user accounts
   with email/password or OAuth (Google, GitHub) for the web console.

3. **Stripe deposits** — `/billing` page needs a "Add Credits" button that
   opens Stripe Checkout.

4. **Usage time series** — need to store daily aggregated usage in SQLite
   for the billing/earnings graphs.

5. **Provider earnings endpoint** — `GET /v1/providers/me/earnings` filtered
   by the logged-in provider's account.
