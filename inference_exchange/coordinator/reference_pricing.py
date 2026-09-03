"""Reference pricing -- live prices from OpenRouter and public API pricing pages.

Fetches real-time pricing from OpenRouter's public API (no key needed) and
compares against the exchange's prices. Falls back to cached/static data
if the API is unreachable.

OpenRouter API: https://openrouter.ai/api/v1/models (public, no auth)
"""

import logging
import time

import httpx

logger = logging.getLogger(__name__)

# Cache: refreshed every 10 minutes
_cache: dict = {"models": {}, "last_fetch": 0}
_CACHE_TTL = 600  # 10 minutes

# Known major API providers with their own pricing (not on OpenRouter)
DIRECT_API_PRICES: dict[str, list[dict]] = {
    "_openai": [
        {"provider": "OpenAI", "model": "gpt-4o-mini", "input": 0.15, "output": 0.60},
        {"provider": "OpenAI", "model": "gpt-4o", "input": 2.50, "output": 10.00},
    ],
    "_anthropic": [
        {"provider": "Anthropic", "model": "claude-3.5-haiku", "input": 0.80, "output": 4.00},
        {"provider": "Anthropic", "model": "claude-3.5-sonnet", "input": 3.00, "output": 15.00},
    ],
    "_google": [
        {"provider": "Google", "model": "gemini-1.5-flash", "input": 0.075, "output": 0.30},
        {"provider": "Google", "model": "gemini-1.5-pro", "input": 1.25, "output": 5.00},
    ],
}


def _fetch_openrouter_prices() -> dict[str, dict]:
    """Fetch live model pricing from OpenRouter's public API."""
    now = time.time()
    if _cache["models"] and (now - _cache["last_fetch"]) < _CACHE_TTL:
        return _cache["models"]

    try:
        resp = httpx.get("https://openrouter.ai/api/v1/models", timeout=10)
        if resp.status_code != 200:
            logger.warning(f"OpenRouter API returned {resp.status_code}")
            return _cache["models"]

        data = resp.json()
        models = {}
        for m in data.get("data", []):
            model_id = m.get("id", "")
            pricing = m.get("pricing", {})
            prompt_price = float(pricing.get("prompt", "0") or "0")
            completion_price = float(pricing.get("completion", "0") or "0")
            if prompt_price > 0 or completion_price > 0:
                # OpenRouter prices are per token, convert to per Mtok
                models[model_id] = {
                    "id": model_id,
                    "name": m.get("name", model_id),
                    "input": prompt_price * 1_000_000,  # $/Mtok
                    "output": completion_price * 1_000_000,  # $/Mtok
                    "context": m.get("context_length", 0),
                }

        _cache["models"] = models
        _cache["last_fetch"] = now
        logger.info(f"Fetched {len(models)} models from OpenRouter")
        return models

    except Exception as e:
        logger.warning(f"Failed to fetch OpenRouter prices: {e}")
        return _cache["models"]


def _match_model_family(model_name: str) -> str:
    """Extract model family from a model name for matching."""
    name = model_name.lower()
    for family in ["llama", "qwen", "mistral", "gemma", "phi", "codellama", "deepseek", "yi"]:
        if family in name:
            return family
    return ""


def get_reference_prices(model_name: str) -> list[dict]:
    """Get reference prices for a model from OpenRouter + major APIs."""
    or_models = _fetch_openrouter_prices()
    family = _match_model_family(model_name)
    refs = []

    # Find matching models on OpenRouter
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

    # Add direct API comparisons (OpenAI, Anthropic, Google) - always relevant
    for provider_key, prices in DIRECT_API_PRICES.items():
        # Use the cheapest model from each major provider as comparison
        if prices:
            cheapest = min(prices, key=lambda p: p["output"])
            refs.append({
                "provider": cheapest["provider"],
                "model": cheapest["model"],
                "input": cheapest["input"],
                "output": cheapest["output"],
            })

    # Sort by output price ascending
    refs.sort(key=lambda r: r["output"])
    return refs[:5]  # Top 5 comparisons


def compute_savings(exchange_price: float, model_name: str) -> dict:
    """Compute savings vs reference providers."""
    refs = get_reference_prices(model_name)
    comparisons = []
    for ref in refs:
        ref_output = ref["output"]
        if ref_output > 0 and exchange_price > 0:
            pct_savings = round((1 - exchange_price / ref_output) * 100)
            comparisons.append({
                "provider": ref["provider"],
                "model": ref["model"],
                "price_output": ref_output,
                "savings_pct": max(0, pct_savings),
            })
    # Only show refs where exchange is cheaper
    comparisons = [c for c in comparisons if c["savings_pct"] > 0]
    return {"comparisons": comparisons, "exchange_price": exchange_price}
