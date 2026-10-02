# Model Capabilities: Design Document

**Issue:** #43 — Model capabilities from HuggingFace (format-agnostic)

## Problem

The exchange currently knows about model capabilities only through GGUF metadata extracted on the provider side. This has three problems:

1. **Format-coupled.** vLLM/TGI providers serving SafeTensors have no GGUF metadata to read. Their capabilities show up as zeros.
2. **Incomplete.** GGUF metadata includes `context_length` and `architecture`, but says nothing about tool calling or vision support.
3. **Scattered.** Capability data is reconstructed ad-hoc in `routes_exchange.py` by reading `model_identity` dicts. There's no canonical "what can this model do?" object.

## Design Principles

1. **Capabilities are a property of the model, not the weight format.** Llama 3.1 8B supports the same context window and tool calling whether it's served from GGUF or SafeTensors.
2. **Three-source merge with clear precedence.** Provider-reported → HuggingFace API → inference from metadata. Provider always wins because it knows its actual runtime configuration.
3. **Coordinator owns the canonical capability record.** Providers report what they know; the coordinator enriches, caches, and serves the result. No client-side resolution.
4. **Lazy and cached.** HF lookups happen once per base model, not per provider. Gated repos that return 401 are handled gracefully — capabilities degrade to provider-reported only.

## Architecture

```
Provider                          Coordinator                         UI
┌─────────────────┐    register   ┌───────────────────────────┐     ┌───────────┐
│ GGUF metadata   │──────────────>│ ProviderCapabilities      │     │ capability│
│ (ctx, arch,     │               │ (protocol.py)             │     │ badges    │
│  quant, hash)   │               │                           │     │           │
│                 │               │ + context_length           │     │ ctx: 128k │
│ llama-server    │               │ + supports_vision          │────>│ 🔧 tools  │
│  /props         │               │ + supports_tool_calling    │     │ 👁 vision │
│                 │               │ + model_repo_id            │     │ GGUF Q4   │
│ vLLM model info │               │ + model_format             │     └───────────┘
└─────────────────┘               │                           │
                                  │        ┌──────────────┐   │
                                  │        │ ModelCapCache │   │
                                  │        │ (per base_model) │
                                  │        │              │   │
                                  │        │ HF config.json│  │
                                  │        │ HF tokenizer  │  │
                                  │        │ HF tags       │  │
                                  │        └──────────────┘   │
                                  └───────────────────────────┘
```

## Data Model

### New: `ModelCapabilities` (shared/protocol.py)

A standalone Pydantic model representing what a model can do. This is the canonical shape consumed by routing, the API, and the UI.

```python
class ModelCapabilities(BaseModel):
    """Format-agnostic model capabilities resolved from multiple sources."""
    context_length: int = 0
    supports_vision: bool = False
    supports_tool_calling: bool = False
    architecture: str = ""         # e.g. "LlamaForCausalLM", "Qwen2ForCausalLM"
    model_type: str = ""           # e.g. "llama", "qwen2", "mistral"
    model_repo_id: str = ""        # HF base model repo, e.g. "meta-llama/Llama-3.1-8B-Instruct"
    model_format: str = ""         # "gguf", "safetensors", "gptq", "awq"
```

This is **separate from** `ProviderCapabilities`. `ProviderCapabilities` describes the provider's pricing, trust level, concurrency, hardware. `ModelCapabilities` describes what the model itself can do. They're related but distinct — one provider can serve multiple models, and multiple providers can serve the same model with different capabilities (e.g. different context windows due to memory constraints).

### Extended: `ProviderCapabilities` (shared/protocol.py)

Add fields for the provider to report what it knows. These are hints that feed into the merge, not the final truth:

```python
class ProviderCapabilities(BaseModel):
    # ... existing fields (models, max_concurrent, trust_level, hardware, etc.)
    
    # NEW: provider-reported capability hints
    context_length: int = 0           # actual runtime ctx (may differ from model's max)
    supports_tool_calling: bool = False
    supports_vision: bool = False
    model_repo_id: str = ""           # HF repo for coordinator lookup
    model_format: str = ""            # "gguf", "safetensors", "gptq", "awq"
```

All new fields default to zero/False/empty, so existing providers that don't report them continue to work — the coordinator falls back to HF lookup or GGUF metadata.

### Extended: `RegisterMessage` (shared/protocol.py)

No changes needed. `model_identity` already carries GGUF metadata as an open dict, and the new `ProviderCapabilities` fields handle the rest. The `model_identity` dict remains the escape hatch for format-specific metadata (GGUF file_type, block_count, etc.).

## New Module: `capability_resolver.py`

A new module in `coordinator/` that owns the resolution logic. Single responsibility: given a provider's registration data, produce resolved `ModelCapabilities`.

```python
# coordinator/capability_resolver.py

class ModelCapabilityCache:
    """Cache of HF-derived capabilities, keyed by base model repo ID.
    
    One entry per base model (not per quant/format). Thread-safe for
    concurrent provider registrations.
    """
    
    def __init__(self):
        self._cache: dict[str, ModelCapabilities] = {}
        self._pending: set[str] = set()  # repos currently being fetched
        self._failed: dict[str, float] = {}  # repo → timestamp of last failure
        self._RETRY_AFTER = 3600  # retry failed lookups after 1 hour
    
    async def resolve(
        self,
        provider_caps: ProviderCapabilities,
        model_identity: dict | None,
    ) -> ModelCapabilities:
        """Resolve capabilities using three-source merge.
        
        Priority: provider-reported > HF API > GGUF metadata inference
        """
        ...
```

### Three-Source Merge

The resolver applies data from three sources in priority order:

**Source 1: Provider-reported** (highest priority)
- `ProviderCapabilities.context_length` — the actual runtime window (may be smaller than model max due to memory)
- `ProviderCapabilities.supports_tool_calling` / `supports_vision`
- `ProviderCapabilities.model_format`

**Source 2: HuggingFace API** (fills gaps)
- `config.json` → `max_position_embeddings`, `architectures`, `model_type`, `vision_config`
- `tokenizer_config.json` → `chat_template` tool keyword detection
- `repo_info` → `pipeline_tag` (e.g. `image-text-to-text` for vision), tags

**Source 3: GGUF metadata** (from `model_identity` dict, lowest priority)
- `context_length` from `{arch}.context_length`
- `architecture` from `general.architecture`
- `quantization` from `general.file_type`

The merge rule is simple: for each field, take the first non-zero/non-empty value in priority order.

### GGUF → Base Model Resolution

GGUF quant repos (e.g. `bartowski/Meta-Llama-3.1-8B-Instruct-GGUF`) don't contain `config.json` or `tokenizer_config.json`. The capability-relevant files live in the base model repo.

Resolution strategy (tested against real HF API):
1. Check `repo_info.card_data.base_model` — most GGUF repos set this
2. Fall back to `base_model:` tag (without `:quantized:` or `:finetune:` qualifier)
3. If both fail, use the `model_repo_id` the provider reports (if any)

This was verified to work for bartowski, TheBloke, and NousResearch GGUF repos. The only failure mode is gated models (Meta Llama) that return 401 without a HF token — in that case we degrade to GGUF-metadata-only capabilities, which still gives us context_length and architecture.

### `repo_id` Sourcing on the Provider Side

The provider needs to report `model_repo_id` so the coordinator can do the HF lookup. Three sources in order:

1. **CLI argument**: `--repo-id meta-llama/Llama-3.1-8B-Instruct` — explicit, always wins
2. **GGUF metadata**: `general.source.huggingface.repository` key (some GGUF files include this)
3. **Path inference**: if the model lives under `~/.cache/huggingface/hub/models--org--name/`, extract the repo ID from the path structure

If none of these produce a value, the provider sends `model_repo_id = ""` and the coordinator can still try to resolve via `model_identity["name"]` + `model_catalog.parse_model_info()`.

## File Changes

### `inference_exchange/shared/protocol.py`
- Add `ModelCapabilities` model
- Add new fields to `ProviderCapabilities`: `context_length`, `supports_tool_calling`, `supports_vision`, `model_repo_id`, `model_format`

### `inference_exchange/coordinator/capability_resolver.py` (NEW)
- `ModelCapabilityCache` class with async `resolve()` method
- HF `config.json` / `tokenizer_config.json` fetching
- GGUF → base model repo resolution
- Three-source merge logic
- TTL-based cache with retry-after for failures

### `inference_exchange/coordinator/main.py`
- Create `ModelCapabilityCache` at startup alongside other singletons
- After `verify_model_hash()`, call `cache.resolve(reg.capabilities, reg.model_identity)`
- Store resolved `ModelCapabilities` on `ConnectedProvider`

### `inference_exchange/coordinator/provider_hub.py`
- Add `model_capabilities: ModelCapabilities` field to `ConnectedProvider`

### `inference_exchange/coordinator/routes_exchange.py`
- In `/v1/exchange/market`, read from `ConnectedProvider.model_capabilities` instead of ad-hoc `model_identity` parsing
- Include resolved capabilities in market data response

### `ocip_agent/agent.py`
- Report `model_repo_id` in `ProviderCapabilities` (from CLI arg or metadata inference)
- Report `model_format` (detect from file extension or metadata)
- Report `context_length` from GGUF metadata (already available in `model_identity`)
- Add `--repo-id` CLI arg

### `inference_exchange/provider/model_identity.py`
- Add helper to extract `source.huggingface.repository` from GGUF metadata
- Add helper to infer repo_id from HuggingFace cache path

### `web/src/pages/Exchange.tsx`
- Add capability badges to model cards: context window pill, tool-calling badge, vision badge, format tag
- Read from the new resolved fields in the market API response

## Capability Detection: What Works (Tested)

| Signal | Source | Reliability | Notes |
|--------|--------|------------|-------|
| `max_position_embeddings` | `config.json` | High | Works for all open models. Gated models need HF token. |
| `vision_config` in config | `config.json` | High | Present in all VL models tested (Qwen2.5-VL, Llama-3.2-Vision). |
| `pipeline_tag == "image-text-to-text"` | repo_info | High | HF sets this for all vision models. |
| Tool keywords in `chat_template` | `tokenizer_config.json` | Medium-High | Works for Qwen, Mistral, Hermes. Some models support tools but don't mention them in the template. |
| `chat_template` variant named `"tool_use"` | `tokenizer_config.json` | High | Hermes-3 uses this pattern. Highly reliable when present. |
| `card_data.base_model` | repo_info | High | Works for GGUF repos from bartowski, TheBloke, NousResearch. |
| `{arch}.context_length` | GGUF metadata | High | Every GGUF file includes this. Only source for gated models without HF token. |

## Failure Modes

| Scenario | Behavior | Degradation |
|----------|----------|-------------|
| Gated HF repo (no token) | 401 on config.json download | Fall back to GGUF metadata (context_length, architecture) |
| GGUF repo with no base_model tag | Can't resolve to base model | Fall back to GGUF metadata only |
| HF API down | Timeout/connection error | Provider-reported + GGUF metadata; retry after 1 hour |
| Provider doesn't report repo_id | `model_repo_id = ""` | Coordinator tries name-based inference via model_catalog |
| Model not on HuggingFace | No repo found | Provider-reported only (context_length from GGUF or llama-server) |
| New model format (not GGUF/SafeTensors) | Unknown format | Provider reports capabilities directly; HF lookup still works if repo_id is provided |

## Caching Strategy

- Cache is **per base model repo**, not per provider or per quant. `Qwen/Qwen2.5-0.5B-Instruct` is fetched once regardless of how many providers serve it in different quantizations.
- Cache lives in memory (process lifetime). No persistence needed — HF lookups are cheap (two small JSON files) and happen at provider registration time.
- Failed lookups are cached with a retry-after timestamp (1 hour). Prevents hammering HF on gated repos.
- Cache key is the resolved base model repo ID (e.g. `Qwen/Qwen2.5-0.5B-Instruct`), not the GGUF repo ID.

## Merge Example

A provider registers with:
```
ProviderCapabilities:
  models: ["Qwen2.5-0.5B-Instruct-Q4_K_M"]
  context_length: 0            # doesn't know
  supports_tool_calling: False  # doesn't know
  model_repo_id: ""            # doesn't know
  model_format: "gguf"

model_identity:
  name: "Qwen2.5 0.5B Instruct"
  architecture: "qwen2"
  context_length: 32768        # from GGUF metadata
  quantization: "Q4_K_M"
  file_hash: "abc123..."
```

Coordinator resolves:
1. Parse model name → infer `Qwen/Qwen2.5-0.5B-Instruct` as candidate repo
2. Fetch from HF: `config.json` → `max_position_embeddings: 32768`, `tokenizer_config.json` → tools detected
3. Merge:
   - `context_length`: provider=0, HF=32768, GGUF=32768 → **32768** (HF wins over nothing)
   - `supports_tool_calling`: provider=False, HF=True → **True**
   - `supports_vision`: provider=False, HF=False → **False**
   - `architecture`: HF="Qwen2ForCausalLM"
   - `model_format`: provider="gguf" → **"gguf"**

Later, a second provider registers the same model via vLLM (SafeTensors). The coordinator reuses the cached HF capabilities — no second fetch.

## API Response Changes

### `/v1/exchange/market` — per-model capabilities

Currently, `context_length`, `quantization`, and `verified` are per-provider fields nested under `providers[]`. The new design adds **model-level** capability fields to the outer model object:

```json
{
  "models": [{
    "model": "Qwen 2.5 0.5B Instruct",
    "canonical_id": "qwen-0.5b-instruct",
    "capabilities": {
      "context_length": 32768,
      "supports_vision": false,
      "supports_tool_calling": true,
      "architecture": "Qwen2ForCausalLM",
      "model_type": "qwen2"
    },
    "providers": [{
      "id": "provider-1",
      "context_length": 32768,
      "quantization": "Q4_K_M",
      "format": "gguf",
      "verified": true,
      ...
    }, {
      "id": "provider-2",
      "context_length": 32768,
      "quantization": "",
      "format": "safetensors",
      "verified": false,
      ...
    }],
    ...
  }]
}
```

Key distinction: `capabilities` is model-level (same for all providers serving this model), while `context_length`/`quantization`/`format` per provider can differ (a provider might run with a reduced context window, or a specific quantization).

### `/v1/exchange/providers` — per-provider capabilities

Add `model_capabilities` to each provider entry so consumers can filter by capability:

```json
{
  "providers": [{
    "id": "provider-1",
    "model_capabilities": {
      "context_length": 32768,
      "supports_tool_calling": true,
      "supports_vision": false
    },
    ...
  }]
}
```

## Design Non-Goals

Things this design intentionally avoids:

1. **No hardcoded capability tables.** We don't maintain a list of "Llama supports tools, Qwen supports vision." Capabilities are detected dynamically from HF metadata. If a model adds tool calling in a new version, the exchange picks it up automatically.

2. **No format-specific detection paths in the coordinator.** The coordinator doesn't know or care whether the provider is running GGUF vs SafeTensors. It receives structured `ProviderCapabilities` and enriches from HF. Format-specific metadata extraction stays on the provider side.

3. **No capability promises.** `supports_tool_calling: true` means "the model's chat template includes tool-calling syntax." It does NOT mean the provider's inference server is configured to handle tool calls. Runtime verification is #14.

4. **No blocking on HF lookups.** Provider registration completes immediately. HF capability resolution is async — if HF is slow or down, the provider is registered with whatever capabilities it self-reported. The cache is populated in the background and subsequent API reads pick it up.

## Dependencies

`huggingface-hub` is already a required dependency (not optional). The new `capability_resolver.py` uses `hf_hub_download` for proper redirect handling and `HfApi.repo_info` for metadata. No new dependencies needed.

## Routing Compatibility

The matching engine (`coordinator/matching/`) uses `ProviderOffer` as a clean DTO — it's separate from `ConnectedProvider` and `ProviderCapabilities`. Future capability-based routing (e.g. "give me a provider that supports tool calling") would add filter fields to `InferenceOrder` and predicate logic to `GreedyStrategy.match()`. The `ModelCapabilities` object on `ConnectedProvider` makes this straightforward without any structural changes to the matching module. That work is explicitly out of scope here.

## Testing Strategy

Follow existing patterns from `test_model_identity.py`:

- **`test_capability_resolver.py`**: Unit test the three-source merge logic with fixtures. No HF calls — mock the HF fetcher. Test: provider-reported wins, HF fills gaps, GGUF is fallback, merge with all sources empty returns zero-defaults.
- **`test_model_catalog.py`**: Test `parse_from_hf_repo()` for repo_id → family/size parsing (already partially covered by existing model_catalog code).
- **Integration**: Extend `test_model_identity.py` with tests for repo_id extraction from GGUF metadata and HF cache paths.
- **The HF API probing logic** (fetch config.json, parse tokenizer) should have its own unit tests with fixture JSON files, not live HF calls.

## Not In Scope (Follow-ups)

- **Routing by capability** (e.g. "give me a provider that supports tool calling") — separate issue, clean extension point exists
- **Runtime capability verification** (actually testing tool calling works) — #14
- **Quantization-specific quality differences** (Q2 vs Q8 output quality) — deferred
- **HF token management** for gated model access — separate concern, coordinator config
- **Persisting the cache** across restarts — not needed for alpha; HF fetches are fast and happen at registration time
