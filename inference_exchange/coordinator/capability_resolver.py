"""Capability resolver — detects model capabilities from HuggingFace metadata.

Given a provider's registration data, resolves format-agnostic ModelCapabilities
by merging three sources with clear precedence:

  1. Provider-reported (highest) — actual runtime configuration
  2. HuggingFace API — config.json, tokenizer_config.json, repo tags
  3. GGUF metadata (lowest) — embedded in the weight file

Results are cached per base model repo so multiple providers serving the same
model (in different formats/quantizations) share one HF lookup.
"""

import json
import logging
import tempfile
import time

from inference_exchange.shared.protocol import ModelCapabilities, ProviderCapabilities

logger = logging.getLogger(__name__)

# Keywords in chat_template that indicate tool-calling support
_TOOL_KEYWORDS = frozenset([
    "tool_call", "tool_calls", "<tool_call>", "tools",
    "ipython", "function_call", "<|python_tag|>", "tool_use",
])


def _fetch_hf_json(repo_id: str, filename: str) -> dict | None:
    """Download a JSON file from a HuggingFace repo.

    Uses hf_hub_download for proper redirect and auth handling.
    Returns None on any failure (gated repo, missing file, network error).
    """
    try:
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(repo_id, filename, cache_dir=tempfile.gettempdir())
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        logger.debug(f"Could not fetch {filename} from {repo_id}: {e}")
        return None


def _resolve_base_model(repo_id: str) -> str | None:
    """Resolve a GGUF/quant repo to its base model repo via HF metadata.

    GGUF repos don't contain config.json — capability files live in the
    base model repo. Uses card_data.base_model and base_model: tags.
    """
    try:
        from huggingface_hub import HfApi

        api = HfApi()
        info = api.repo_info(repo_id)
    except Exception as e:
        logger.debug(f"Could not fetch repo_info for {repo_id}: {e}")
        return None

    # Strategy 1: card_data.base_model
    card_data = getattr(info, "card_data", None)
    base = getattr(card_data, "base_model", None) if card_data else None
    if base:
        if isinstance(base, list):
            base = base[0] if base else None
        if base:
            return base

    # Strategy 2: base_model tag (without :quantized: or :finetune: qualifier)
    for tag in info.tags or []:
        if tag.startswith("base_model:") and ":quantized:" not in tag and ":finetune:" not in tag:
            return tag.split(":", 1)[1]

    return None


def _detect_capabilities_from_hf(repo_id: str) -> ModelCapabilities | None:
    """Fetch config.json and tokenizer_config.json from a HF repo.

    Returns ModelCapabilities with whatever fields could be extracted,
    or None if the repo is inaccessible.
    """
    config = _fetch_hf_json(repo_id, "config.json")
    if config is None:
        return None

    # Context length
    context_length = config.get("max_position_embeddings", 0)
    if not context_length and "text_config" in config:
        context_length = config["text_config"].get("max_position_embeddings", 0)

    # Architecture
    archs = config.get("architectures", [])
    architecture = archs[0] if archs else ""
    model_type = config.get("model_type", "")

    # Vision: vision_config in config.json
    supports_vision = "vision_config" in config

    # Vision: also check pipeline_tag and tags from repo_info
    if not supports_vision:
        try:
            from huggingface_hub import HfApi

            info = HfApi().repo_info(repo_id)
            if info.pipeline_tag == "image-text-to-text":
                supports_vision = True
            elif any("vision" in t.lower() for t in (info.tags or [])):
                supports_vision = True
        except Exception:
            pass

    # Tool calling: scan chat_template for tool keywords
    supports_tool_calling = False
    tok = _fetch_hf_json(repo_id, "tokenizer_config.json")
    if tok:
        template = tok.get("chat_template", "")
        if isinstance(template, list):
            # Multiple template variants — check all, and also check variant names
            all_text = " ".join(t.get("template", "") for t in template)
            if any("tool" in t.get("name", "").lower() for t in template):
                supports_tool_calling = True
        else:
            all_text = str(template)
        if not supports_tool_calling:
            supports_tool_calling = any(kw in all_text.lower() for kw in _TOOL_KEYWORDS)

    return ModelCapabilities(
        context_length=context_length,
        supports_vision=supports_vision,
        supports_tool_calling=supports_tool_calling,
        architecture=architecture,
        model_type=model_type,
        model_repo_id=repo_id,
    )


def _capabilities_from_gguf_identity(identity: dict) -> ModelCapabilities:
    """Extract capabilities from the GGUF model_identity dict."""
    return ModelCapabilities(
        context_length=identity.get("context_length", 0),
        architecture=identity.get("architecture", ""),
    )


def _merge_capabilities(
    provider: ModelCapabilities,
    hf: ModelCapabilities | None,
    gguf: ModelCapabilities | None,
) -> ModelCapabilities:
    """Merge capabilities from three sources. First non-zero/non-empty wins."""

    sources = [provider]
    if hf:
        sources.append(hf)
    if gguf:
        sources.append(gguf)

    def first_truthy(field: str):
        for s in sources:
            val = getattr(s, field)
            if val:
                return val
        return getattr(ModelCapabilities(), field)

    return ModelCapabilities(
        context_length=first_truthy("context_length"),
        supports_vision=first_truthy("supports_vision"),
        supports_tool_calling=first_truthy("supports_tool_calling"),
        architecture=first_truthy("architecture"),
        model_type=first_truthy("model_type"),
        model_repo_id=first_truthy("model_repo_id"),
        model_format=first_truthy("model_format"),
    )


class ModelCapabilityCache:
    """Cache of HF-derived capabilities, keyed by base model repo ID.

    One entry per base model (not per quant/format). Failed lookups are
    cached with a retry-after timestamp to avoid hammering HF.
    """

    _RETRY_AFTER = 3600  # retry failed lookups after 1 hour

    def __init__(self):
        self._cache: dict[str, ModelCapabilities] = {}
        self._failed: dict[str, float] = {}  # repo → timestamp of last failure

    def resolve(
        self,
        provider_caps: ProviderCapabilities,
        model_identity: dict | None = None,
    ) -> ModelCapabilities:
        """Resolve capabilities using three-source merge.

        This is synchronous because HF downloads are small JSON files
        and provider registration can tolerate the latency.
        """
        # Source 1: provider-reported
        provider_source = ModelCapabilities(
            context_length=provider_caps.context_length,
            supports_vision=provider_caps.supports_vision,
            supports_tool_calling=provider_caps.supports_tool_calling,
            model_repo_id=provider_caps.model_repo_id,
            model_format=provider_caps.model_format,
        )

        # Source 3: GGUF metadata (extract early, used for repo resolution too)
        gguf_source = None
        if model_identity:
            gguf_source = _capabilities_from_gguf_identity(model_identity)

        # Source 2: HuggingFace API (cached per base model repo)
        hf_source = self._resolve_from_hf(provider_caps, model_identity)

        result = _merge_capabilities(provider_source, hf_source, gguf_source)
        logger.info(
            f"Capabilities resolved: ctx={result.context_length}, "
            f"vision={result.supports_vision}, tools={result.supports_tool_calling}, "
            f"arch={result.architecture}, repo={result.model_repo_id}"
        )
        return result

    def _resolve_from_hf(
        self,
        provider_caps: ProviderCapabilities,
        model_identity: dict | None,
    ) -> ModelCapabilities | None:
        """Resolve capabilities from HuggingFace, using cache."""
        # Determine the repo to look up
        repo_id = provider_caps.model_repo_id
        if not repo_id and model_identity:
            repo_id = model_identity.get("repo_id", "")

        # Try to resolve a GGUF repo to its base model
        base_repo = None
        if repo_id:
            # Check if this is a GGUF/quant repo (no config.json) — resolve to base
            base_repo = self._try_resolve_base(repo_id)

        lookup_repo = base_repo or repo_id
        if not lookup_repo:
            return None

        # Check cache
        if lookup_repo in self._cache:
            return self._cache[lookup_repo]

        # Check failure cache
        if lookup_repo in self._failed:
            if time.time() - self._failed[lookup_repo] < self._RETRY_AFTER:
                return None
            del self._failed[lookup_repo]

        # Fetch from HF
        caps = _detect_capabilities_from_hf(lookup_repo)
        if caps:
            self._cache[lookup_repo] = caps
            return caps

        # Cache the failure
        self._failed[lookup_repo] = time.time()
        return None

    def _try_resolve_base(self, repo_id: str) -> str | None:
        """If repo_id is a GGUF/quant repo, resolve to the base model repo."""
        # Quick heuristic: if repo has config.json in cache, it's already a base repo
        if repo_id in self._cache:
            return repo_id

        base = _resolve_base_model(repo_id)
        if base and base != repo_id:
            logger.info(f"Resolved GGUF repo {repo_id} → base model {base}")
            return base
        return None
