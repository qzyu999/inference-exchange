# Inference Exchange -- Product Design

How a two-sided marketplace for AI inference should work, from both the
consumer and provider perspectives. Every feature exists to help one or
both sides make better decisions.

## The Core Principle

IE is not a service. It's a marketplace. We don't run inference. We match
people who need inference with people who have compute. Our job is to make
that matching as informed, fair, and frictionless as possible.

Both sides are equal partners:
- Consumers want the best inference for their needs (model, speed, price, privacy)
- Providers want to earn as much as possible from their idle hardware
- The platform provides the information and infrastructure for both to optimize

## 1. The Consumer Experience

### 1.1 What a consumer needs to decide

Before sending a single request, a consumer needs answers to:

| Question | Where they find the answer |
|---|---|
| What models are available? | Models page / Exchange market view |
| How much does it cost? | Exchange (per-model pricing with reference comparison) |
| How fast will it be? | Exchange (TPS per provider) |
| How private is it? | Trust level badges (L0-L3) on each provider |
| Is this really the model claimed? | Verification badge (verified vs unverified) |
| What quantization? | Quantization badge (Q4_K_M, 4-bit, FP16, etc.) |
| How long can my conversation be? | Context length display (8k, 32k, 128k) |
| How reliable is this provider? | Reputation score + success rate |
| How does this compare to OpenAI? | Reference pricing (honest, all competitors shown) |

### 1.2 Consumer journeys

**Journey A: "I just want to chat"**
1. Land on homepage -> click "Start a conversation"
2. Chat page opens with "Any model (default)" selected
3. Type a message, get a response
4. See the model used, cost, and speed in message metadata
5. No decisions needed -- the exchange picked the best available

**Journey B: "I want a specific model"**
1. Browse Models page -> search "llama 3.1"
2. See available models with pricing and provider count
3. Click "Chat with this model" -> Chat opens with model pre-selected
4. Advanced: set preference (cheapest/fastest/most secure)

**Journey C: "I need privacy"**
1. Browse Exchange -> filter by trust level L2+
2. See only hardened providers with verification badges
3. Select model -> Chat with min_trust=hardened
4. Use IE SDK for response encryption (full E2E)
5. See "E2E" badge on every message confirming encryption

**Journey D: "I'm building an app"**
1. Sign up -> get API key with $10 credit
2. Go to API Keys page -> see curl/Python/TypeScript examples
3. Copy the code snippet -> change base_url in their existing OpenAI code
4. Works immediately -- same API, different provider, cheaper

### 1.3 Consumer UX principles

- **Default to simple.** The Chat page should work with zero configuration.
  Model=default, preference=balanced. One text box, one send button.
- **Progressive disclosure.** Advanced controls (trust level, max price,
  quantization filter) are hidden until the consumer asks for them.
- **Every metric explained.** Hover on any badge/number and see what it
  means. "L2 Hardened" -> tooltip: "This provider's process is protected by
  kernel-level security. A macOS kernel exploit ($500k+) is required to
  observe your data."
- **No jargon without context.** "Q4_K_M" means nothing to most people.
  Show it for power users but also show "4-bit quantization (fast, good quality)".
- **Honest about limitations.** If a model is unverified, say so. If a
  provider is L0 (no privacy), say "this provider CAN see your prompts."

## 2. The Provider Experience

### 2.1 What a provider needs to decide

Before serving their first request, a provider needs answers to:

| Question | Where they find the answer |
|---|---|
| What model should I serve? | Exchange (demand by model, which models get requests) |
| What price should I set? | Exchange (competitor pricing, reference API prices) |
| What engine should I use? | Provider docs (engine comparison, performance by hardware) |
| What trust level can I achieve? | Provider docs (hardening guide per engine/platform) |
| How much will I earn? | Provider dashboard (projected earnings based on current rates) |
| Am I competitive? | Exchange (my price/speed vs other providers for the same model) |
| What hardware do I need? | Provider docs (model size vs RAM, quantization tradeoffs) |

### 2.2 Provider journeys

**Journey A: "I have a Mac sitting idle"**
1. Visit Providers page -> see "Become a provider" CTA
2. Install: `pip install ie-provider`
3. Pick a model: `ie-provider models` (shows popular models with demand)
4. Start: `ie-provider start --model llama-3.1-8b`
5. See earnings accumulate on the Provider dashboard

**Journey B: "I want to maximize earnings"**
1. Check Exchange -> see which models have highest demand
2. See reference pricing -> understand the market ceiling
3. Check competitor providers -> find an underserved model/quality niche
4. Set price just below the cheapest competitor for that model
5. Achieve L2 hardening -> attract privacy-conscious consumers willing to pay more

**Journey C: "I want to run multiple models"**
1. Use Ollama (built from source, hardened) as the engine
2. `ollama pull llama3.1:8b && ollama pull qwen2.5:7b`
3. Both models register automatically on the exchange
4. Ollama handles hot-swapping based on incoming requests
5. Earn from both model markets simultaneously

### 2.3 Provider UX principles

- **One command to start.** `ie-provider start` should handle everything:
  engine detection, model download, hardening (if possible), registration.
- **Earnings visibility.** Providers are motivated by money. Show earnings
  prominently: today, this week, all-time. Show projected earnings based
  on current utilization.
- **Market intelligence.** Show what models are in demand, what the going
  rate is, where there's a gap in the market. Help providers make smart
  pricing decisions.
- **No required technical knowledge.** The provider doesn't need to understand
  GGUF vs SafeTensors. They pick a model, the system picks the format.
- **Hardening should be automatic.** If the provider's platform supports L2
  (Apple Silicon + our build), harden by default. Don't ask the provider to
  run cmake and codesign -- do it for them.

## 3. The Exchange Experience (Shared)

The Exchange page serves both sides simultaneously:

### 3.1 For consumers (the "buy" side)

What they see per model:
- **Price range** (cheapest to most expensive provider)
- **Speed range** (slowest to fastest)
- **Trust levels available** (which levels are offered)
- **Provider count** (more providers = more competition = better for consumers)
- **Reference comparison** (honest: "30% cheaper than OpenAI" or "20% more than OpenRouter")
- **Verification status** (how many providers are hash-verified)
- **"Chat with this model"** one-click action

### 3.2 For providers (the "sell" side)

What they see per model:
- **Competing providers** (who else is serving this model, at what price)
- **Reference ceiling** (OpenAI/Anthropic price -- the max a consumer would pay)
- **Demand indicators** (request volume, preference distribution)
- **Their own position** (where they rank on price, speed, trust)
- **Earnings data** (how much providers are earning for this model)

### 3.3 Real-time activity (shared)

Both sides benefit from seeing:
- **Live trade ticker** (requests matched in real time)
- **Event feed** (provider connects/disconnects, attestation results)
- **Volume** (total $ flowing through the exchange)

This creates a "liveness" feeling -- the exchange is active, money is flowing,
opportunities exist.

## 4. Information Architecture

### 4.1 Pages and who they serve

| Page | Primary audience | Purpose |
|---|---|---|
| Landing | Both (new visitors) | Explain the product, build trust, convert |
| Exchange | Both (active participants) | Market data, price discovery, real-time activity |
| Chat | Consumers | Send inference requests |
| Models | Consumers | Browse and search available models |
| Providers | Providers (and curious consumers) | Node status, earnings, setup guide |
| Billing | Consumers | Balance, transaction history, credits |
| API Keys | Consumers (developers) | Key management, code snippets |
| Login/Signup | Both | Account creation |

### 4.2 Missing pages (future)

| Page | Audience | Purpose |
|---|---|---|
| Provider Dashboard | Providers | Earnings breakdown, performance stats, market position |
| Model Detail | Both | Deep view of one model: all providers, pricing history, demand |
| Settings | Both | Account settings, notification preferences, default trust level |
| Docs / Wiki | Both | How the exchange works, trust levels explained, API reference |

### 4.3 Do we need a wiki / docs site?

**Yes, but not yet.** For alpha, in-app tooltips and the landing page "how it works"
section are sufficient. For beta, a proper docs site (like Stripe Docs or
OpenAI Platform docs) is needed for:

- API reference (endpoints, parameters, response formats)
- Trust level deep-dive (what each level means technically)
- Provider setup guides (per engine, per platform)
- Consumer integration guides (per SDK, per framework)
- Pricing explanation (how billing works, minimum charges)
- Security whitepaper (the threat model, in prose form)
- FAQ

The docs site should be built with something simple (Docusaurus, Mintlify,
or even a /docs route in the React app with MDX) and link from the main nav.
It should NOT be a separate wiki -- it should feel like part of the product.

## 5. Design Language

### 5.1 Visual identity

- **Warm and trustworthy**, not cold and technical
- **Amber/gold accent** -- represents value, exchange, premium
- **Clean white space** -- Apple-inspired simplicity
- **Rounded corners** (2xl) -- approachable, modern
- **Subtle shadows and borders** -- depth without heaviness

### 5.2 Information density

- **Landing page**: Low density. Big headlines, one idea per section.
- **Exchange page**: Medium-high density. Data-rich but organized into cards.
- **Chat page**: Low density. The conversation is the focus.
- **Admin/Billing**: High density. Tables, numbers, details for power users.

### 5.3 Badges and visual vocabulary

Trust levels have consistent colors everywhere:
- L0 Open: gray
- L1 Contained: blue
- L2 Hardened: amber
- L3 Confidential: emerald

Verification:
- Verified: blue checkmark
- Unverified: gray warning icon
- Partial: yellow warning icon

Status:
- Online: emerald dot
- Degraded: amber dot
- Offline: red dot

Actions:
- Primary: black button (high-contrast, clear call to action)
- Secondary: white button with border
- Destructive: red button

## 6. Key Product Decisions

### 6.1 Decided

| Decision | Choice | Why |
|---|---|---|
| Pricing model | Per-token (input + output) | Industry standard, fair to both sides |
| Platform fee | 10% | Low enough to attract providers, enough to sustain platform |
| Default credits | $10 free on signup | Low barrier to try, enough for ~100 requests |
| Trust default | L0 (any provider) | Simplest for beginners, opt-in to privacy |
| Model default | "default" (any available) | Works even with one provider |
| Preference default | Balanced | Fair middle ground |
| API compatibility | OpenAI SDK format | Zero migration cost for consumers |

### 6.2 Open questions (to resolve before beta)

| Question | Options | Considerations |
|---|---|---|
| Provider minimum price | Free market vs floor | Floor prevents race to bottom but limits competition |
| Model whitelisting | Open vs curated | Open = more models, curated = better UX |
| Provider vetting | Anyone vs approved | Open is better for growth, vetting is better for trust |
| Earnings withdrawal | Immediate vs threshold | Threshold reduces payment processing costs |
| Multi-model per provider | Auto vs manual | Ollama supports it natively, others need config |
| KV cache pricing | Same as fresh vs discounted | Discounted encourages session affinity (good for both sides) |

## 7. Measuring Success

### 7.1 Consumer metrics

- Signup-to-first-request time (target: < 2 minutes)
- Request success rate (target: > 99%)
- Average response latency (target: < 2s for first token)
- Return rate (do consumers come back?)

### 7.2 Provider metrics

- Registration-to-first-earning time (target: < 10 minutes)
- Average utilization (target: > 30%)
- Provider retention (do they keep serving?)
- Earnings per provider per day

### 7.3 Platform metrics

- Total providers online (growth)
- Total models available (breadth)
- Total volume traded (market size)
- Consumer-to-provider ratio (market balance)
- Average price per Mtok (market efficiency)
