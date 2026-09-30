# Exchange Page — Design Document

## The problem

A consumer wants to run inference. They need to choose a model and provider.
The current inference market gives them almost no help:

- OpenRouter shows one price per model (output $/Mtok). The actual cost depends
  on 6+ pricing dimensions they don't see.
- There's no way to compare quality across model families.
- The "best" option depends on the consumer's specific workload, which nobody
  asks them about.

The Exchange page should be the place where consumers make an informed choice.
Not a trading terminal. Not a dashboard. A decision-support tool that works for
everyone from "I just want to chat" to "I'm optimizing a production pipeline."

## How inference differs from buying a stock

These structural differences determine what the Exchange can and cannot be:

| Dimension | Stock (AAPL) | Inference |
|-----------|-------------|-----------|
| Product | Fungible — one share = another | Not fungible — Claude != DeepSeek |
| Price | One number (NBBO) | 6+ dimensions (in/cache-read/cache-write/out/reasoning/search) |
| Total cost | Price x quantity | Depends on your token mix and cache rate |
| Quality | Known — it's AAPL | Partially observable, task-dependent |
| Price discovery | Continuous, supply/demand driven | Set by providers, rarely changes |
| Market depth | Deep — thousands of orders | Thin — 1-3 providers per model |
| Bid side | Buyers post limit orders | No bids — consumers send requests |

Implication: the Exchange is a **price comparison engine with quality context**,
not an order book. It's closer to Google Flights than to a CME terminal.
The "exchange" metaphor is about transparency and fair comparison, not about
matching bids and offers.

## The consumer's decision

Formally, the consumer solves:

> Given my workload (task type, token mix, cache rate, quality floor),
> find the model + provider that minimizes cost subject to quality >= my floor.
> Or: maximizes quality subject to cost <= my budget.

This is a constrained optimization over the product of:
- ~438 models with pricing
- ~136 models with quality benchmarks
- 4+ workload dimensions (input tokens, output tokens, cache rate, task type)

The Exchange page should solve this for the consumer, not dump the raw data.

## The cost model

The cost of a single inference request:

```
C = (I_fresh / 1M) * p_input
  + (I_cached / 1M) * p_cache_read
  + (O / 1M) * p_output
  + (R / 1M) * p_reasoning       [if applicable]
  + N_search * p_web_search      [if applicable]
```

Where:
- `I_fresh = I_total * (1 - cache_rate)`
- `I_cached = I_total * cache_rate`
- `p_cache_read` falls back to `p_input` when no cache pricing exists
- Cache write pricing (`p_cache_write`) is a one-time cost per cache entry,
  not per request — it affects the first request in a session, not steady state

### Key findings from the analytical notebook

- **68% of models** have cache read pricing (300 / 438)
- **Median cache discount is 90%** off input price
- For a chatbot workload (75% cache rate), caching saves 34-38% on total cost
- For a RAG pipeline (20% cache rate), caching saves only 8-14%
- **The cheapest model changes depending on workload type** — there is no
  single "cheapest model" without knowing the workload
- **The Pareto frontier is small**: 6-9 models per workload type represent
  the full set of rational choices (out of 438 total)

## User profiles and what each needs

### Profile 1: Minimally informed ("I just want to chat")

**Mental model**: "I want to talk to an AI. I've heard of ChatGPT and Claude."

**What they know**: Model names from marketing. Nothing about tokens, pricing,
cache rates, or quality benchmarks.

**What they need from the Exchange**: A recommendation. One sentence. Click and go.

**What the Exchange should do**: Run the cost model with default assumptions
(chatbot workload: 2K input, 400 output, 75% cache), pick the Pareto-optimal
model at a mid-quality level, and present it as: "Recommended: [Model X] at
~$Y per message."

**Design**: Layer 0 — a recommendation card at the top of the page. Big,
clear, actionable. "Use this" button goes to Chat. No jargon.

### Profile 2: Moderately informed ("I'm building an app")

**Mental model**: "I know I want Claude Sonnet or something equivalent.
I want to compare my options and understand costs."

**What they know**: Model families, rough token concepts, that different
providers exist. They don't know their exact cache hit rate or token
distributions.

**What they need from the Exchange**: A comparison table for their chosen
model or quality tier. Sorted by effective cost. With enough context to
understand why one option is cheaper (cache pricing, quality tradeoff).

**What the Exchange should do**: Show a clean comparison table for the
selected model. Columns: provider, effective cost (computed from a sensible
default workload), output price, cache discount, quality score. Let them
change the model. Show a few alternatives at comparable quality.

**Design**: Layer 1 — the comparison table. This is the primary view for most
users. Model selector at top, table in center, alternatives below.

### Profile 3: Highly informed ("I'm optimizing a production pipeline")

**Mental model**: "I know my token distributions. My p50 input is 4200 tokens,
my cache rate is 62% on average, and I need coding_index >= 60."

**What they know**: Everything. They want the raw data and the tools to
analyze it.

**What they need from the Exchange**: The full workload configurator,
all pricing dimensions, Pareto frontier charts, sensitivity analysis,
the ability to export data or use the API directly.

**What the Exchange should do**: Expose the full cost model with
configurable inputs. Show the Pareto frontier for their configured workload.
Let them see how rankings change as they adjust parameters.

**Design**: Layer 2 (workload configurator) + Layer 3 (analytical views).
These are opt-in panels that expand from the default view.

## Progressive disclosure layers

The Exchange page is a single page with four layers. Each layer shares the
same data and the same cost model. They differ in how much they expose.

### Layer 0: Recommendation (always visible)

A card at the top:

```
┌─────────────────────────────────────────────────────────┐
│  For general use, we recommend:                         │
│                                                         │
│  [Model Name]  via [Provider]                           │
│  ~$0.003 per typical message                            │
│  Quality: ██████████░░ 30.1 intelligence                │
│                                                         │
│  [Use this →]    [See alternatives]                     │
└─────────────────────────────────────────────────────────┘
```

Computed from: default chatbot workload, mid-quality Pareto frontier pick.
If the user has usage history, recompute from their actual workload.

"See alternatives" scrolls to Layer 1.

### Layer 1: Comparison table (always visible, below recommendation)

```
Model selector:  [Claude Sonnet 4.6] [GPT-4.1 Mini] [Llama 8B] [DeepSeek R1] ...

Provider          Eff. cost*   Output    Cache disc.   Quality   
─────────────────────────────────────────────────────────────────
▸ IE: home-m2      $0.0082     $15.00    -90%          30.1 intel
  OpenRouter       $0.0082     $15.00    -90%          30.1
  Anthropic API    $0.0082     $15.00    -90%          30.1

  Alternatives at lower cost:
  ─────────────────────────────────────────────────────────
  GPT-4.1          $0.0044     $8.00     -75%          —
  Claude Haiku 4.5 $0.0027     $5.00     -90%          16.9
  DeepSeek R1      $0.0012     $2.19     -75%          11.4

* Effective cost: 2,000 input / 75% cache / 400 output tokens (chatbot)
  [Customize workload ↓]
```

Key design decisions:
- Sorted by effective cost, not output price
- Cache discount shown as a percentage, not a raw price
- Quality score inline, not in a separate panel
- Alternatives shown below a separator, not mixed in
- The asterisk footnote tells you the workload assumption and lets you change it

### Layer 2: Workload configurator (collapsed by default)

Clicking "Customize workload" expands:

```
┌─ Your workload ──────────────────────────────────────────┐
│                                                          │
│  Preset: [Chatbot] [Code] [RAG] [Agent] [Custom]        │
│                                                          │
│  Input tokens    ████████████░░░░  2,000                 │
│  Cache hit rate  ████████████████░  75%                   │
│  Output tokens   ██████░░░░░░░░░░  400                   │
│                                                          │
│  When you adjust these, the comparison table re-sorts    │
│  and the recommendation updates.                         │
└──────────────────────────────────────────────────────────┘
```

The presets map to the workload profiles from the analytical notebook:
- Chatbot: 2K in, 400 out, 75% cache
- Code: 4K in, 800 out, 60% cache
- RAG: 6K in, 300 out, 20% cache
- Agent: 3K in, 200 out, 85% cache
- Custom: user sets all three

Changing the preset or sliders immediately re-computes effective cost for
every provider in the table and re-sorts. The recommendation updates too.

### Layer 3: Market intelligence (collapsed, opt-in)

Clicking "Market intelligence" (or a similar toggle) expands:

```
┌─ Market intelligence ────────────────────────────────────┐
│                                                          │
│  Quality vs Price (Pareto frontier)                      │
│  [scatter plot: cost on X, quality on Y, frontier line]  │
│                                                          │
│  Cache rate sensitivity                                  │
│  [line chart: cost vs cache rate for top 4 models]       │
│                                                          │
│  Full pricing breakdown                                  │
│  [table: all 6+ pricing dimensions for all providers]    │
│                                                          │
│  Market structure                                        │
│  438 models · 59 vendors · 300 with cache pricing        │
│  68% have cache pricing · median cache discount 90%      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

This is where the exchange_analytics notebook outputs live.
Most users never open this. Power users live here.

## Data requirements

All layers use the same backend data:

| Endpoint | Data | Used by |
|----------|------|---------|
| `/v1/exchange/reference-prices` | All external provider pricing (6 dims) + benchmarks | All layers |
| `/v1/exchange/market` | IE provider pricing + capabilities | Layers 0-3 |
| `/v1/exchange/stats` | Provider count, fill count | Layer 0 |
| `/v1/exchange/traces` | Recent fills | Layer 1 |

The cost model (`request_cost()`) runs in the frontend. The backend provides
raw pricing; the frontend computes effective cost based on the user's
workload configuration.

The Pareto frontier computation also runs in the frontend — it's a simple
sort + scan (O(n log n)) over at most 438 models.

## What IE shows that nobody else does

1. **Cache read pricing** — 68% of models have it, median 90% discount.
   Nobody surfaces this. It changes the cost ranking.

2. **Effective cost per request** — computed from your actual workload,
   not a headline output price. The cheapest model changes depending on
   your token mix and cache rate.

3. **Quality-adjusted comparison** — benchmark scores next to prices.
   "DeepSeek R1 costs 85% less but has 38% of the quality." That's an
   informed tradeoff, not a blind price sort.

4. **Workload-specific recommendations** — different presets produce
   different rankings. A chatbot user and a RAG user should see different
   recommendations.

5. **Cache write pricing visibility** — Anthropic and Google charge for
   cache writes. This is a hidden cost that hits the first request in
   a session. Making it visible is honest.

6. **Trust and encryption** — for IE providers, trust level and E2E
   encryption status. External providers don't have this. It's a
   differentiator for security-conscious consumers.

## What IE is NOT

- Not a financial exchange with continuous price discovery
- Not an order book with bids and asks
- Not a trading terminal with depth-of-market visualization
- Not a real-time price ticker (prices change quarterly, not per-second)

It's a **price comparison engine with quality context and workload awareness**.
The "exchange" metaphor is about transparency, fair comparison, and the ability
to route to the best provider for your needs — not about financial market
mechanics.

## Implementation sequence

1. **Cost model in frontend** — implement `request_cost()` in TypeScript,
   add workload presets.

2. **Layer 1: Comparison table** — rebuild the current Exchange offer table
   to sort by effective cost, show cache discount, show quality score.
   Use the reference-prices endpoint data.

3. **Layer 0: Recommendation** — compute the Pareto-optimal mid-quality
   pick for the default workload, show it as a card above the table.

4. **Layer 2: Workload configurator** — add presets and sliders that
   re-sort the table.

5. **Layer 3: Market intelligence** — add the Pareto frontier chart and
   sensitivity curves as a collapsible panel.

Each step is independently shippable and testable.
