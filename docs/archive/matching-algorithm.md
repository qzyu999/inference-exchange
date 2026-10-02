# Matching Algorithm -- Complete Design

How the exchange matches consumer requests to providers, handling every
combination of specified and unspecified parameters, fallbacks, and edge cases.

## 1. The Parameters

A consumer request can specify any subset of these parameters.
Unspecified parameters get defaults.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| model | string | "default" | Which model to use |
| preference | enum | "balanced" | Optimization target |
| min_confidence | enum | "hardened" | Minimum trust level |
| max_price | float | infinity | Max $/Mtok output |
| min_tps | float | 0 | Minimum tokens/sec |
| quantization | string | any | Preferred quantization |
| verified_only | bool | false | Only hash-verified providers |
| encrypted_only | bool | false | Only E2E-capable providers |
| session_id | string | none | Session affinity hint |
| max_context | int | 0 | Required context length |

### 1.1 What consumers actually specify (expected usage patterns)

| Pattern | What they specify | Everything else |
|---|---|---|
| "Just chat" | Nothing | All defaults (L2 hardened minimum) |
| "Use this model" | model | Defaults |
| "Cheap inference" | preference=cheapest | Defaults (still L2 minimum) |
| "Cheap, any provider" | preference=cheapest, min_confidence=open | Explicitly opts out of privacy |
| "Private inference" | min_confidence=hardened, encrypted_only=true | Defaults already provide L2 |
| "Specific model, cheap" | model + preference=cheapest | Defaults |
| "High quality, verified" | model + quantization=Q8_0 + verified_only=true | Defaults |
| "SDK integration" | model + max_price | Defaults |
| "Full spec" | model + preference + min_confidence + max_price + verified_only | Rare, power users |

Most consumers will specify 0-2 parameters. The algorithm must produce
good results with minimal input.

## 2. The Algorithm

### 2.1 Phase 1: Filter (hard constraints)

Remove any provider that violates a MUST-HAVE constraint.
These are non-negotiable -- a provider either passes or doesn't.

```
For each provider:
  REJECT if:
    - model != "default" AND model not in provider.models
    - provider.price_output > max_price
    - provider.trust_level < min_confidence
    - provider.available_slots == 0 (fully loaded)
    - max_context > 0 AND provider.context_length < max_context
    - verified_only == true AND provider.verified == false
    - encrypted_only == true AND provider.encrypted == false
    - quantization specified AND provider.quantization != quantization
```

After filtering: we have a set of eligible providers (could be 0).

### 2.2 Phase 2: Score (soft preferences)

For each eligible provider, compute a composite score.
Higher score = better match.

```
score = w_price * price_score
      + w_speed * speed_score
      + w_trust * trust_score
      + w_load  * load_score

Where:
  price_score = 1 / (1 + price)           # cheaper = higher, range [0, 1]
  speed_score = tps / (10 + tps)           # faster = higher, range [0, ~1]
  trust_score = trust_level_value / 4      # L0=0, L1=0.25, L2=0.5, L3=0.75
  load_score  = 1 - load_factor            # less loaded = higher, range [0, 1]

Weights by preference:
  balanced:     w = (0.35, 0.25, 0.20, 0.20)
  cheapest:     w = (0.60, 0.15, 0.10, 0.15)
  fastest:      w = (0.10, 0.60, 0.10, 0.20)
  most_secure:  w = (0.10, 0.10, 0.60, 0.20)

Modifiers:
  score *= (0.5 + 0.5 * reputation)       # rep [0,1] scales score 50%-100%
  score *= 1.2 if session_affinity match   # 20% bonus for KV cache benefit
```

### 2.3 Phase 3: Select

Pick the provider with the highest score.

### 2.4 Phase 4: Fallback (if no eligible providers)

This is the critical part that needs to handle every edge case.

## 3. Fallback Behavior -- Every Scenario

### 3.1 No providers at all (exchange is empty)

```
Trigger: hub.provider_count == 0
Response: 503 "No providers are currently online. Try again later."
UI: Chat shows friendly message with estimated wait time if known
```

### 3.2 Providers exist but none serve the requested model

```
Trigger: model != "default" AND no provider has this model
Current: 503 "No provider available for model X"

PROPOSED IMPROVEMENT -- suggest alternatives:
Response: 503 with body:
{
  "error": "No provider available for model 'Llama-3.1-70B-Instruct'",
  "available_models": ["Meta Llama 3.1 8B Instruct", "Qwen2.5 7B Instruct"],
  "suggestion": "Try 'Meta Llama 3.1 8B Instruct' (same family, smaller)"
}

UI: Chat shows: "Llama 3.1 70B isn't available right now. Would you like
to try Llama 3.1 8B instead? [Yes, switch] [No, wait]"
```

### 3.3 Providers serve the model but all fail hard constraints

**Price too low:**
```
Trigger: All providers exceed max_price
Response: 503 with body:
{
  "error": "No provider within your price limit of $0.05/Mtok",
  "cheapest_available": 0.10,
  "suggestion": "Increase max price to $0.10 or remove the limit"
}

UI: "The cheapest provider charges $0.10/Mtok. Your limit is $0.05.
[Increase limit] [Remove limit]"
```

**No hardened providers available (default trust constraint):**
```
Trigger: No providers at or above min_confidence (default: hardened/L2)
Response: 503 with body:
{
  "error": "No L2+ hardened provider available for this model",
  "available_levels": ["open", "contained"],
  "suggestion": "Lower trust requirement to L1 or try later",
  "privacy_warning": "L0/L1 providers CAN read your prompts"
}

UI: "No hardened providers are online for this model.
Available: L0 Open, L1 Contained.
⚠️ These providers can see your prompts.
[Accept L1 (provider can see prompts)] [Wait for L2+]"
```

**All at capacity:**
```
Trigger: All eligible providers have load_factor >= 1.0
Action: Queue the request (up to 50 depth, 30s timeout)
Response: Request enters queue, consumer gets SSE stream that waits
UI: "All providers are busy. You're #3 in queue. Estimated wait: ~10s"
```

**Quantization not available:**
```
Trigger: model matches but no provider has the requested quantization
Response: 503 with body:
{
  "error": "No provider has Q8_0 quantization for Llama 3.1 8B",
  "available_quantizations": ["Q4_0", "Q4_K_M"],
  "suggestion": "Try Q4_K_M (good quality, faster)"
}

UI: "Q8_0 isn't available. Q4_K_M is available and offers good quality.
[Use Q4_K_M] [Wait for Q8_0]"
```

### 3.4 Auto-matching: when model="default"

When the consumer says "default" (or doesn't specify a model):

```
1. All models are eligible
2. Score ALL providers across ALL models using the preference weights
3. Pick the highest-scoring provider regardless of model
4. The consumer gets whichever model the best provider happens to serve

This is the "I don't care, just give me good inference" mode.
Most casual consumers will use this.
```

### 3.5 Family-based fallback (PROPOSED, not yet built)

When a specific model isn't available, automatically suggest models from
the same family:

```
Consumer requests: "Llama-3.1-70B-Instruct"
No provider has it.

Algorithm:
1. Parse model name -> family="llama", size="70B", variant="Instruct"
2. Find all available models in the "llama" family
3. Rank by size (prefer closest size) and variant match
4. Suggest: "Llama 3.1 8B Instruct (smaller, available now)"

Consumer requests: "Qwen2.5-72B-Instruct"
No provider has it.

Algorithm:
1. Parse -> family="qwen", size="72B", variant="Instruct"
2. Find "Qwen2.5 7B Instruct" available
3. Suggest: "Qwen2.5 7B Instruct (same family, smaller)"
```

This uses the model_catalog.py parsing to extract family/size/variant
and find the closest match.

### 3.6 Auto-fallback (PROPOSED, opt-in only)

For SDK/API users who want maximum availability:

```
POST /v1/chat/completions
{
  "model": "llama-3.1-70b",
  "ocip_auto_fallback": true,    # <-- opt-in
  ...
}

If "llama-3.1-70b" is not available:
  1. Find closest family match (llama-3.1-8b)
  2. Use it automatically
  3. Response header: X-OCIP-Fallback: true
  4. Response header: X-OCIP-Original-Model: llama-3.1-70b
  5. Response header: X-OCIP-Actual-Model: llama-3.1-8b

Consumer code can check X-OCIP-Fallback to know a substitution happened.
```

This is useful for applications where "some response" is better than an error.
NOT enabled by default -- the consumer must opt in.

## 4. Parameter Resolution Matrix

What happens for every combination of specified/unspecified parameters:

| model | preference | trust | price | What happens |
|---|---|---|---|---|
| default | default | default | default | Best L2+ provider by balanced scoring |
| specific | default | default | default | Best L2+ provider for that model |
| default | cheapest | default | default | Cheapest L2+ provider across all models |
| default | cheapest | open | default | Cheapest provider (any trust level, consumer opted down) |
| default | default | hardened | default | Same as default (L2 is the default) |
| specific | cheapest | hardened | $0.20 | Cheapest hardened provider for that model under $0.20 |
| specific | default | default | default | If unavailable: suggest family alternatives |
| default | most_secure | confidential | default | If no L3 provider: suggest L2, explain difference |
| specific | fastest | default | $0.10 | Fastest L2+ under $0.10, fail if none exist at that price |

## 5. Queue Behavior

When all eligible providers are at capacity:

```
1. Request enters queue (FIFO, max 50 pending requests)
2. Consumer gets response with Transfer-Encoding: chunked
3. No data sent yet -- connection held open
4. When a provider frees a slot, dispatch checks the queue
5. First queued request matching the freed provider gets dispatched
6. Timeout: 30 seconds. After that, 503 with friendly message.

Queue position is NOT communicated to the consumer currently.
PROPOSED: Send SSE comment during wait:
  : queue_position=3
  : estimated_wait_seconds=12
```

## 6. Session Affinity

When a consumer sends `ocip_session_id`:

```
1. Check if this session was previously served by a provider
2. If that provider is still online and eligible: give 20% score bonus
3. This biases (but doesn't force) toward the same provider
4. Benefit: KV cache may still be warm, reducing prefill time

If the previous provider is:
  - Offline: treat as no affinity, pick normally
  - At capacity: still scored with bonus, but load_score penalizes,
    so it may lose to a less-loaded provider anyway
  - Serving a different model now (Ollama hot-swap): still eligible if
    the model the consumer wants is in the provider's model list
```

## 7. What the Consumer Sees vs What's Happening

### 7.1 Happy path

```
Consumer: "Hello, what is 2+2?"
[200ms] Matched to provider-1 (Llama 3.1 8B, $0.10, L2, 42 t/s)
[500ms] First token arrives
[2.0s]  Response complete: "2+2 equals 4."
        Footer: Meta Llama 3.1 8B Instruct | 12 tokens | $0.000001 | E2E
```

### 7.2 Model not available

```
Consumer selects "Llama 3.1 70B" and sends "Hello"
[200ms] No provider for 70B
Chat shows:
  "Llama 3.1 70B isn't available right now.
   Similar models available:
   - Meta Llama 3.1 8B Instruct ($0.10/Mtok, 1 provider) [Use this]
   - Qwen2.5 7B Instruct ($0.08/Mtok, 1 provider) [Use this]
   [Wait for 70B]"
```

### 7.3 Queued

```
Consumer sends "Hello" but all providers are busy
[200ms] Entered queue, position 2
Chat shows typing indicator with:
  "All providers are busy. Waiting... (position 2)"
[8s] Provider frees up, request dispatched
[8.5s] First token arrives
```

### 7.4 No providers at all

```
Consumer sends "Hello" but exchange is empty
[200ms] 503
Chat shows:
  "No providers are online right now. The exchange is empty.
   [Become a provider] or try again later."
```

### 7.5 Budget exceeded

```
Consumer sends "Hello" with max_price=$0.01
All providers charge >= $0.10
[200ms] 503
Chat shows:
  "No provider available within your budget ($0.01/Mtok).
   Cheapest available: $0.10/Mtok.
   [Remove price limit] [Increase to $0.10]"
```

## 8. Implementation Status

| Feature | Status | Code location |
|---|---|---|
| Basic matching (score + filter) | BUILT | matching/strategy.py |
| Preference weights | BUILT | matching/strategy.py compute_score() |
| Session affinity | BUILT | provider_hub.py select_provider() |
| Reputation modifier | BUILT | matching/strategy.py compute_score() |
| Request queuing | BUILT | provider_hub.py enqueue_request() |
| Queue timeout (30s) | BUILT | routes_inference.py |
| Friendly error messages | BUILT | Chat.tsx error parsing |
| Model suggestion on unavailable | NOT BUILT | Needs family-based fallback |
| Auto-fallback (opt-in) | NOT BUILT | Needs ocip_auto_fallback param |
| Queue position feedback | NOT BUILT | Needs SSE comment during wait |
| Quantization filter | NOT BUILT | Needs quantization in matching |
| Context length filter | NOT BUILT | Needs context in matching |
| verified_only filter | NOT BUILT | Needs verification in matching |
| encrypted_only filter | NOT BUILT | Needs encryption in matching |
| Budget exceeded suggestion | NOT BUILT | Needs structured error response |
| Model unavailable suggestion | NOT BUILT | Needs family-based matching |

## 9. Priority for Alpha

| Priority | Feature | Impact |
|---|---|---|
| 1 | Model suggestion when unavailable | Prevents dead-end for consumers |
| 2 | Structured error responses with alternatives | Actionable errors, not just "503" |
| 3 | verified_only and encrypted_only filters | Key differentiator for privacy users |
| 4 | Context length filter | Prevents failed long conversations |
| 5 | Budget exceeded with cheapest price shown | Helps consumers adjust expectations |
| 6 | Auto-fallback (opt-in) | Better SDK experience |
| 7 | Queue position feedback | Better waiting experience |
| 8 | Quantization filter | Power user feature |
