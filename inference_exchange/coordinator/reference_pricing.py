"""Reference pricing — comparison against external providers.

Uses the PriceCollector's cache when available (new system).
Falls back to direct OpenRouter fetch for backward compatibility
if the collector hasn't been initialized.
"""

import logging
import time

import httpx

from .model_catalog import parse_model_info

logger = logging.getLogger(__name__)

# Legacy cache for backward compat (used only if PriceCollector not available)
_legacy_cache: dict = {"models": {}, "last_fetch": 0}
_CACHE_TTL = 600


def _get_collector():
    """Try to get the PriceCollector singleton. Returns None if not initialized."""
    try:
        from .dependencies import get_price_collector
        return get_price_collector()
    except Exception:
        return None


def _fetch_openrouter_prices_legacy() -> dict[str, dict]:
    """Legacy: direct OpenRouter fetch. Used only if PriceCollector is not available."""
    now = time.time()
    if _legacy_cache["models"] and (now - _legacy_cache["last_fetch"]) < _CACHE_TTL:
        return _legacy_cache["models"]
    try:
        resp = httpx.get("https://openrouter.ai/api/v1/models", timeout=10)
        if resp.status_code != 200:
            return _legacy_cache["models"]
        data = resp.json()
        models = {}
        for m in data.get("data", []):
            model_id = m.get("id", "")
            pricing = m.get("pricing", {})
            prompt_price = float(pricing.get("prompt", "0") or "0")
            completion_price = float(pricing.get("completion", "0") or "0")
            if prompt_price > 0 or completion_price > 0:
                models[model_id] = {
                    "id": model_id,
                    "name": m.get("name", model_id),
                    "input": prompt_price * 1_000_000,
                    "output": completion_price * 1_000_000,
                    "context": m.get("context_length", 0),
                }
        _legacy_cache["models"] = models
        _legacy_cache["last_fetch"] = now
        return models
    except Exception as e:
        logger.warning(f"Legacy OpenRouter fetch failed: {e}")
        return _legacy_cache["models"]


def get_reference_prices(model_name: str) -> list[dict]:
    """Get reference prices for a model from all available sources."""
    collector = _get_collector()

    if collector and collector.cache:
        # New system: use PriceCollector cache
        info = parse_model_info(model_name)
        family_key = info["canonical_id"]
        family = info["family"]

        refs = []
        seen = set()
        for entry in collector.get_all_current():
            # Match by family key or family name
            if family_key == entry.family_key or (family and family == entry.family):
                key = (entry.source, entry.model_id)
                if key not in seen:
                    seen.add(key)
                    refs.append({
                        "provider": entry.source,
                        "model": entry.display_name,
                        "input": round(entry.input_per_mtok, 4),
                        "output": round(entry.output_per_mtok, 4),
                        "comparison_type": "same_model" if entry.family else "alternative",
                    })

        # Always include cheapest closed-source as reference point
        closed_sources = {"openai", "anthropic", "google"}
        for entry in collector.get_all_current():
            if entry.source in closed_sources:
                key = (entry.source, entry.model_id)
                if key not in seen:
                    seen.add(key)
                    refs.append({
                        "provider": entry.source,
                        "model": entry.display_name,
                        "input": round(entry.input_per_mtok, 4),
                        "output": round(entry.output_per_mtok, 4),
                        "comparison_type": "alternative",
                    })

        refs.sort(key=lambda r: r["output"])
        return refs[:8]

    # Legacy fallback
    or_models = _fetch_openrouter_prices_legacy()
    family = ""
    name_lower = model_name.lower()
    for f in ["llama", "qwen", "mistral", "gemma", "phi", "codellama", "deepseek", "yi"]:
        if f in name_lower:
            family = f
            break

    refs = []
    for model_id, data in or_models.items():
        if family and family in model_id.lower():
            refs.append({
                "provider": "OpenRouter",
                "model": data["name"],
                "input": round(data["input"], 4),
                "output": round(data["output"], 4),
            })
        if len(refs) >= 3:
            break

    refs.sort(key=lambda r: r["output"])
    return refs[:5]


def compute_savings(exchange_price: float, model_name: str) -> dict:
    """Compute honest comparison vs reference providers.

    Separates same-model comparisons from alternative-model comparisons.
    Shows ALL prices, not just favorable ones.
    Flags quantization differences when detectable.
    """
    refs = get_reference_prices(model_name)
    comparisons = []
    for ref in refs:
        ref_output = ref["output"]
        if ref_output > 0 and exchange_price > 0:
            pct_diff = round((1 - exchange_price / ref_output) * 100)
            entry = {
                "provider": ref["provider"],
                "model": ref["model"],
                "price_output": round(ref_output, 4),
                "diff_pct": pct_diff,
                "cheaper": pct_diff > 0,
            }
            if "comparison_type" in ref:
                entry["comparison_type"] = ref["comparison_type"]
            comparisons.append(entry)
    return {"comparisons": comparisons, "exchange_price": exchange_price}
