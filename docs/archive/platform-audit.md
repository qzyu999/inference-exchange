# Platform Audit — Consumer/Provider Parity & Gaps

A page-by-page, endpoint-by-endpoint audit of what each persona can do
versus what they need to do. The marketplace claim is that both sides are
equal partners. This audit checks whether that's actually true.

## TL;DR

The platform is heavily consumer-biased. Consumers have a full journey:
browse → chat → bill → manage keys. Providers get a static "pip install"
card and a read-only status list. There's no provider dashboard, no
earnings visibility, no self-service pricing, no configuration UI, and
no way for a provider to understand their position in the market.

The API has the same imbalance: 15+ consumer/marketplace endpoints, zero
provider-facing endpoints (beyond the WebSocket registration protocol).

---

## Page-by-Page Audit

### Landing Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | "Start a conversation" CTA, pricing, trust levels, features | ✅ Good |
| Provider | "Become a provider" CTA → links to /providers | ⚠️ Thin |

The landing page sells to consumers. Providers get a secondary button
that leads to a page with `pip install ie-provider`. No explanation of
earnings potential, no market opportunity framing.

**Gap:** No provider-focused value prop. Should show: average earnings,
demand by model, "providers earned $X this week" social proof.

### Exchange Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Model cards with pricing, provider list per model, reference comparison, trade ticker, live feed | ✅ Good |
| Provider | Can see competitors' prices and their own position (if they know their provider ID) | ⚠️ Passive |

The Exchange is read-only for both sides, which is fine as a marketplace
view. But providers have no way to act on what they see — no "adjust my
price" button, no "serve this model" action.

**Gap:** No provider actions from the Exchange. A provider sees they're
overpriced but has to SSH into their machine and restart `ie-provider`
with new flags.

### Chat Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Full chat UI with model selector, preference pills, trust level, streaming, message metadata | ✅ Good |
| Provider | N/A (not a provider surface) | N/A |

Chat is consumer-only, which is correct.

**Gap (minor):** Message metadata doesn't show which provider served the
request. The `X-OCIP-Provider` header is in the SSE response headers but
isn't parsed and displayed. Consumers should see this — it builds trust
and lets them identify good providers.

### Models Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Browse available models, see pricing, HuggingFace search, "Chat with this model" | ✅ Good |
| Provider | Can see what models have demand, but no action available | ⚠️ Passive |

**Gap:** No "Serve this model" action for providers. If a provider sees
a model with demand but no providers, there should be a CTA: "No one is
serving this yet. [Start serving →]" with a ready-to-use CLI command.

### Providers Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | See provider cards with status, TPS, load, trust, reputation | ✅ Good |
| Provider | Static "pip install" setup card. Can see their own card in the list (if online). | ❌ Inadequate |

This is the biggest gap. The Providers page is a consumer-facing
provider directory, not a provider dashboard. A provider sees:
- Their card in a list (with no "this is you" indicator)
- A generic setup command
- No earnings, no position, no actions

**What a provider needs on this page:**
- "My Provider" section (requires login/token auth)
  - Current status (online/offline, models loaded)
  - Earnings: today, this week, all-time
  - Requests served and success rate
  - Current pricing vs market average
  - "Adjust pricing" controls
  - "Load model" / "Unload model" controls
- Market intelligence
  - Which models are in demand but undersupplied
  - Suggested pricing based on competition
  - Hardware utilization vs capacity
- Setup wizard (not just a CLI command)
  - Step-by-step with hardware detection
  - Model selection with demand context
  - Pricing suggestion
  - Hardening status and upgrade path

### Billing Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Balance, total spent, requests, tokens, transaction history, "reset to $10" | ✅ OK for alpha |
| Provider | Nothing. No earnings view. No payout info. | ❌ Missing |

**Gaps:**
- `POST /v1/auth/reset-balance` is called by the UI but the endpoint
  doesn't exist in the backend. The button silently fails.
- No provider earnings view at all. The `GET /v1/exchange/provider-earnings`
  endpoint exists in the backend but has no UI consuming it.
- No deposit flow (Stripe or otherwise). Just dummy reset.
- No payout/withdrawal flow for providers.

### Keys Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Create/list API keys, static code snippets (curl/Python/TS) | ✅ OK |
| Provider | Nothing. Provider tokens are admin-only. | ❌ Missing |

**Gap:** Provider authentication is entirely admin-managed. A provider
can't create their own token through the UI. The admin has to `POST
/v1/admin/provider-tokens` and hand the token to the provider out of
band. This doesn't scale.

### Login Page
| Audience | What they get | Adequate? |
|---|---|---|
| Consumer | Email/password signup with $10 credit, API key on signup | ✅ Good |
| Provider | Can sign up but there's no provider-specific onboarding | ⚠️ Generic |

**Gap:** No provider registration flow. A provider signs up like a
consumer and gets consumer-focused messaging ("$10 in free credits").
There should be a "I'm a provider" path that leads to setup.

### Admin Page
| Audience | What they get | Adequate? |
|---|---|---|
| Platform admin | Full state dump, accounts, TPS, reputation, traces, telemetry | ✅ Good |
| Consumer | N/A (hidden) | N/A |
| Provider | N/A (hidden) | N/A |

Admin is fine as-is for alpha.

---

## API Endpoint Audit

### Consumer-facing endpoints (all exist and work)

| Endpoint | Method | Purpose | UI? |
|---|---|---|---|
| `/v1/chat/completions` | POST | Inference | Chat page |
| `/v1/models` | GET | List models | Models page, Chat selector |
| `/v1/exchange/stats` | GET | Marketplace stats | Exchange, Landing |
| `/v1/exchange/providers` | GET | Provider list | Exchange, Providers, Models |
| `/v1/exchange/pricing` | GET | Market pricing | Exchange, Landing, Models |
| `/v1/exchange/depth` | GET | Order book depth | Exchange |
| `/v1/exchange/balance` | GET | Consumer balance | Billing |
| `/v1/exchange/history` | GET | Transaction history | Billing |
| `/v1/exchange/traces` | GET | Decision traces | Admin |
| `/v1/exchange/market` | GET | Model market view | Exchange |
| `/v1/exchange/models/search` | GET | HuggingFace search | Models |
| `/v1/exchange/events/recent` | GET | Event feed | Exchange |
| `/v1/exchange/telemetry` | GET | System telemetry | Admin |
| `/v1/exchange/tps` | GET | TPS stats | Admin, Providers |
| `/v1/exchange/reputation` | GET | Reputation scores | Admin, Providers |
| `/v1/encryption-key` | GET | E2E key info | (none) |
| `/v1/auth/signup` | POST | Create account | Login |
| `/v1/auth/login` | POST | Sign in | Login |
| `/v1/auth/logout` | POST | Sign out | Layout |
| `/v1/auth/me` | GET | Current user info | Layout (balance display) |
| `/v1/auth/keys` | POST/GET | API key management | Keys |

### Provider-facing endpoints (gaps)

| What's needed | Exists? | Notes |
|---|---|---|
| Provider registration (get token) | ❌ Admin-only | `POST /v1/admin/provider-tokens` exists but requires admin |
| Provider self-service token | ❌ | Providers can't create their own auth token |
| Provider earnings | ⚠️ API exists, no UI | `GET /v1/exchange/provider-earnings` has no UI |
| Provider pricing update | ❌ | No way to change pricing without restart |
| Provider model management | ❌ | No way to add/remove models without restart |
| Provider status (self-view) | ❌ | No "am I online? what's my status?" endpoint |
| Provider config update | ❌ | No runtime config changes via API |
| Provider payout/withdrawal | ❌ | No earnings withdrawal mechanism |

### Missing endpoints (both sides)

| Endpoint | For | Purpose |
|---|---|---|
| `POST /v1/auth/reset-balance` | Consumer | UI calls it but it doesn't exist |
| `POST /v1/auth/deposit` | Consumer | Add real credits (Stripe) |
| `GET /v1/provider/me` | Provider | My status, earnings, config |
| `PATCH /v1/provider/pricing` | Provider | Update pricing live |
| `PATCH /v1/provider/models` | Provider | Add/remove models live |
| `POST /v1/provider/register` | Provider | Self-service registration |
| `GET /v1/provider/earnings` | Provider | My earnings breakdown |
| `POST /v1/provider/withdraw` | Provider | Request payout |
| `GET /v1/exchange/demand` | Provider | What models are in demand |
| `GET /v1/consumer/preferences` | Consumer | Saved default preferences |
| `PUT /v1/consumer/preferences` | Consumer | Save default preferences |

---

## Severity Assessment

### Critical (blocks provider adoption)

1. **No provider dashboard.** A provider has zero visibility into their
   earnings, performance, or market position through the webapp. They
   must SSH into their machine and read logs. This is the single biggest
   gap.

2. **No provider self-service auth.** Provider tokens require admin
   creation. In a decentralized marketplace, providers need to register
   themselves.

3. **No live pricing updates.** A provider can't adjust their price
   without restarting. In a competitive marketplace, this makes it
   impossible to respond to market changes.

### High (degrades experience)

4. **No provider earnings display.** The API endpoint exists (`/v1/
   exchange/provider-earnings`) but no UI consumes it. Providers are
   motivated by money — not showing them their earnings is leaving the
   strongest motivator on the table.

5. **No demand visibility for providers.** No endpoint or UI shows
   "these models are wanted but undersupplied." Providers are flying
   blind when choosing what to serve.

6. **Reset balance button doesn't work.** The Billing page calls an
   endpoint that doesn't exist. Silent failure.

7. **No consumer preference persistence.** Trust level, preference, and
   other settings reset on page reload. Consumers who always want L2
   have to re-set it every session.

### Medium (should fix before beta)

8. **No provider indicator on messages.** Chat shows model/cost/tokens
   but not which provider served the request.

9. **No "serve this model" CTA for providers.** Models page shows
   demand but gives providers no action.

10. **Provider page has no "this is you" indicator.** If a provider is
    online, their card looks identical to every other card.

11. **No Settings page.** Listed in product-design.md as a future page
    but doesn't exist. Needed for saved preferences, default trust level,
    notification prefs.

---

## Proposed Fix Order

### Phase 1: Provider visibility (unblocks adoption)

1. **Provider Dashboard page** (`/provider/dashboard`)
   - Requires provider auth (token-based, linked to account)
   - Shows: earnings (today/week/all-time), requests served, success rate
   - Shows: current config (models, pricing, trust level)
   - Shows: market position (your price vs competitors)
   - Consumes existing `GET /v1/exchange/provider-earnings` endpoint

2. **Provider self-registration endpoint** (`POST /v1/provider/register`)
   - Linked to user account (same signup, role: provider)
   - Returns provider token
   - No admin involvement

3. **Fix reset-balance** — add `POST /v1/auth/reset-balance` endpoint

### Phase 2: Provider actions (competitive marketplace)

4. **Live pricing update** (`PATCH /v1/provider/pricing`)
   - Provider sends new price → coordinator updates hub → immediate effect
   - UI: pricing controls on provider dashboard

5. **Demand endpoint** (`GET /v1/exchange/demand`)
   - Shows models with high request volume but few/no providers
   - UI: "Opportunities" section on provider dashboard

6. **Model management** (`PATCH /v1/provider/models`)
   - Add/remove models without restart
   - UI: model picker on provider dashboard

### Phase 3: Consumer quality of life

7. **Consumer preference persistence** (`PUT /v1/consumer/preferences`)
   - Save default trust level, preference, max price to account
   - Load on Chat page init

8. **Settings page** (`/settings`)
   - Default trust level, preference, notification prefs
   - API key management (moved from separate page)

9. **Provider attribution on messages**
   - Parse `X-OCIP-Provider` and `X-OCIP-Trust-Level` from SSE headers
   - Display in message metadata

### Phase 4: Money (required for production)

10. **Stripe integration for deposits** (consumer)
11. **Payout mechanism for providers** (Stripe Connect or similar)
12. **Real billing** (remove dummy balance reset)

---

## Navigation Parity Check

Current nav: Home | Exchange | Chat | Models | Providers | Billing | API Keys

This is consumer-centric. A provider visiting the site sees consumer
tools everywhere and provider tools nowhere (except "Providers" which
is actually a provider directory for consumers).

**Proposed nav (role-aware):**

When logged in as consumer:
Home | Exchange | Chat | Models | Providers | Billing | API Keys

When logged in as provider (or dual role):
Home | Exchange | Chat | Models | **My Provider** | Billing | API Keys

The "Providers" page stays as the public directory. "My Provider" is the
dashboard. If someone is both a consumer and provider (which the product
design supports — "self-route" users), they see both.

Alternatively, a simpler approach: add a "Provider Dashboard" link
inside the existing Providers page when the user is authenticated as a
provider. Keeps the nav unchanged but surfaces the dashboard.
