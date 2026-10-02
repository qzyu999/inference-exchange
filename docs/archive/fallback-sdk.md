# Fallback SDK — Bootstrapping Supply with External Providers

The cold-start problem: we launch with consumers but not enough providers.
A consumer who tries the exchange and gets 503 ("no providers available")
on their first request will never come back. The solution is a client SDK
that transparently falls back to external providers (OpenAI, OpenRouter,
etc.) when the exchange can't serve a request.

## The Problem

```
Day 1 of public alpha:
  Consumers: 50 (excited, signed up, got API keys)
  Providers: 3 (running on our test Macs)
  Models available: llama-3-8b, qwen-2.5-7b
  Models consumers want: gpt-4o, claude-sonnet, llama-3-70b, ...

Consumer sends: model=llama-3-70b
Exchange: 503 "No provider available for this model"
Consumer: *leaves, never comes back*
```

Even for models we DO have, the 3 providers might all be busy:

```
Consumer sends: model=llama-3-8b
Exchange: all 3 providers at capacity
Consumer waits 30s → 503 queue timeout
Consumer: "this is unreliable" *switches to OpenRouter*
```

## The Solution: Smart Fallback SDK

A PyPI package (`inference-exchange`) that wraps the OpenAI client SDK
and adds transparent fallback routing. The consumer's code doesn't change
— they import our client instead of OpenAI's and get the exchange when
available, external providers when not.

```python
# Instead of:
from openai import OpenAI
client = OpenAI(api_key="sk-...")

# Consumer uses:
from inference_exchange import InferenceClient
client = InferenceClient(api_key="sk-ie-...")

# Same API, same methods — but with fallback
response = client.chat.completions.create(
    model="llama-3-8b",
    messages=[{"role": "user", "content": "Hello!"}],
)

# response.ie_source tells you where it was served:
# "exchange"    — served by an IE provider (L2 hardened, etc.)
# "openrouter"  — fell back to OpenRouter
# "openai"      — fell back to OpenAI directly
```

## How Fallback Works

```
Consumer request
     │
     ▼
┌─────────────────────┐
│ InferenceClient      │
│                      │
│ 1. Try exchange      │──── POST api.inference.exchange/v1/chat/completions
│    (timeout: 5s)     │          │
│                      │          ├── 200 OK → return response (source: exchange)
│                      │          ├── 503 no provider → fall through
│                      │          ├── 429 rate limit → fall through
│                      │          └── timeout → fall through
│                      │
│ 2. Try fallback chain│──── POST openrouter.ai/api/v1/chat/completions
│    (configured order)│          │
│                      │          ├── 200 OK → return response (source: openrouter)
│                      │          └── error → try next
│                      │
│ 3. Try next fallback │──── POST api.openai.com/v1/chat/completions
│                      │          │
│                      │          └── 200 OK → return response (source: openai)
│                      │
│ 4. All failed        │──── raise InferenceError("all providers failed")
└─────────────────────┘
```

## SDK Design

### Configuration

```python
from inference_exchange import InferenceClient

client = InferenceClient(
    # Exchange credentials (always tried first)
    api_key="sk-ie-...",

    # Fallback chain (tried in order when exchange can't serve)
    fallbacks=[
        {"provider": "openrouter", "api_key": "sk-or-..."},
        {"provider": "openai", "api_key": "sk-..."},
    ],

    # Fallback behavior
    fallback_timeout=5.0,          # seconds to wait for exchange before fallback
    fallback_on_queue=True,        # fall back if request enters queue (don't wait)
    fallback_on_model_missing=True, # fall back if model not on exchange
    prefer_exchange=True,           # always try exchange first even if slower
)
```

### Model Mapping

Different providers name models differently. The SDK handles this:

```python
MODEL_MAP = {
    # Exchange name → {provider: provider_name}
    "llama-3.1-8b": {
        "openrouter": "meta-llama/llama-3.1-8b-instruct",
        "openai": None,  # not available on OpenAI
    },
    "gpt-4o": {
        "openrouter": "openai/gpt-4o",
        "openai": "gpt-4o",
    },
    "claude-sonnet": {
        "openrouter": "anthropic/claude-3.5-sonnet",
        "openai": None,
    },
}
```

If the consumer requests `model="gpt-4o"` and the exchange doesn't have
it, the SDK automatically maps to `openai/gpt-4o` on OpenRouter or
`gpt-4o` on OpenAI.

### Response Metadata

Every response includes metadata about where it was served:

```python
response = client.chat.completions.create(...)

# Standard OpenAI response fields work as normal
print(response.choices[0].message.content)

# Additional metadata (non-breaking — extra attributes)
print(response.ie_source)        # "exchange" | "openrouter" | "openai"
print(response.ie_provider)      # "alpha-node" (if exchange) or "openrouter" (if fallback)
print(response.ie_trust_level)   # "hardened" (if exchange) or "external" (if fallback)
print(response.ie_encrypted)     # True (if exchange E2E) or False (if fallback)
print(response.ie_fallback_reason)  # None | "no_provider" | "model_unavailable" | "timeout" | "queue_full"
```

This lets consumers know when they're getting the exchange's privacy
benefits vs. when they're on a standard provider.

### Streaming

Streaming works the same way — the SDK decides BEFORE opening the stream
which backend to use:

```python
stream = client.chat.completions.create(
    model="llama-3-8b",
    messages=[...],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content, end="")

# After stream completes:
# chunk.ie_source available on the first chunk
```

The fallback decision happens before streaming starts (not mid-stream).
If the exchange returns 503, the SDK opens a fresh stream to the fallback.

### Configuration via Environment Variables

For consumers who don't want to change code at all:

```bash
export IE_API_KEY=sk-ie-...
export IE_FALLBACK_OPENROUTER_KEY=sk-or-...
export IE_FALLBACK_OPENAI_KEY=sk-...
export IE_FALLBACK_TIMEOUT=5
```

```python
from inference_exchange import InferenceClient
client = InferenceClient()  # reads from env
```

## Billing

### When served by the exchange

Normal exchange billing. Consumer pays the exchange, exchange pays the
provider.

### When served by a fallback

Two options:

**Option A: Pass-through (consumer pays external directly)**

The consumer's own API key for the fallback provider is used. The
consumer is billed directly by OpenRouter/OpenAI. The exchange charges
nothing. This is simplest.

```
Consumer → (IE fails) → OpenRouter (consumer's key) → billed by OpenRouter
```

**Option B: Proxy billing (exchange pays, re-bills consumer)**

The exchange has its own OpenRouter/OpenAI keys. It proxies the request
and re-bills the consumer at a markup. More seamless UX (consumer only
needs one API key) but adds financial complexity.

```
Consumer → (IE fails) → OpenRouter (IE's key) → IE re-bills consumer
```

**Recommended for alpha: Option A.** Simpler, no financial liability for
the exchange, consumers understand they're paying the external provider
directly. The SDK just needs the consumer's own keys.

## The Cold-Start Bootstrapping Strategy

The fallback SDK isn't just a reliability feature — it's the bootstrapping
strategy for the marketplace:

```
Phase 1: "Use our SDK, always works (falls back to OpenRouter)"
  → Consumers adopt because it works today
  → Some requests served by exchange, most by fallback
  → Metric: exchange_serve_rate ≈ 5-10%

Phase 2: "Our providers are cheaper for these models"
  → More providers join (earn money)
  → Exchange serves more requests
  → Metric: exchange_serve_rate ≈ 30-50%

Phase 3: "Our providers are cheaper AND more private"
  → Consumers start preferring exchange (L2 hardened)
  → Fallback rate drops
  → Metric: exchange_serve_rate ≈ 80%+

Phase 4: "Fallback is the exception, not the norm"
  → Exchange has enough providers for most models
  → Fallback only for exotic models or capacity spikes
  → Metric: exchange_serve_rate ≈ 95%+
```

The consumer doesn't need to know or care about this progression. Their
code stays the same. The SDK transparently shifts traffic to the exchange
as supply grows.

## What the Consumer Sees

### In the webapp (Chat page)

When a response is served by a fallback:

```
[Assistant] The capital of France is Paris.

Meta Llama 3.1 8B | 15 tok | $0.000003 | via OpenRouter
                                          ^^^^^^^^^^^^^^^^
                                          amber badge: "External — not E2E encrypted"
```

When served by the exchange:

```
[Assistant] The capital of France is Paris.

Meta Llama 3.1 8B | 15 tok | $0.000002 | L2 Hardened | E2E
                                          ^^^^^^^^^^^^^^^^^^^^
                                          green badge: "Served by exchange provider"
```

This creates a natural incentive: consumers SEE when they're getting
the exchange's privacy benefits and when they're not. As exchange
availability grows, more responses get the green badge.

### In the API response headers

```
X-IE-Source: exchange          # or "openrouter", "openai"
X-IE-Provider: alpha-node      # or "openrouter"
X-IE-Trust-Level: hardened     # or "external"
X-IE-Encrypted: true           # or "false"
```

## PyPI Package Structure

```
inference-exchange/           # PyPI package name
  inference_exchange/
    __init__.py               # exports InferenceClient
    client.py                 # main client with fallback logic
    fallbacks/
      __init__.py
      openrouter.py           # OpenRouter adapter
      openai_direct.py        # Direct OpenAI adapter
      anthropic_direct.py     # Direct Anthropic adapter (future)
    model_map.py              # model name mappings across providers
    types.py                  # response types with ie_source etc.
    config.py                 # env var / config file loading
```

Dependencies: `openai>=1.0` (the only required dep — it's the base
client that all adapters use since OpenRouter and most providers are
OpenAI-compatible).

## Open Questions

- **Should the coordinator itself do the fallback?** Instead of the
  client SDK, the coordinator could proxy to OpenRouter when no
  provider is available. Pro: simpler client (just use standard OpenAI
  SDK). Con: coordinator sees plaintext for fallback requests, adding
  latency and trust surface.

- **Should fallback be opt-in or opt-out?** Default-on means consumers
  always get a response. Default-off means privacy-conscious consumers
  don't accidentally send prompts to OpenAI. Probably: default-on with
  a clear `fallback=False` option.

- **Price comparison in real-time?** The SDK could compare exchange
  price vs fallback price and choose the cheaper one even when both
  are available. This turns the SDK into a meta-router, not just a
  fallback mechanism. Probably too complex for alpha.

- **TypeScript/JS SDK?** Many consumers are JS developers (Next.js,
  Vercel AI SDK). A `npm install inference-exchange` package with the
  same fallback logic would expand the consumer base. Same design,
  different language.

- **Model equivalence for fallback?** If a consumer requests
  `llama-3-8b` and the exchange has it but it's busy, should the SDK
  fall back to OpenRouter's `llama-3-8b` (same model, different
  provider) or to a different model entirely? Probably: same model on
  external provider, never a different model.
