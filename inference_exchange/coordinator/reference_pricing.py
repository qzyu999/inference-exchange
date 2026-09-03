"""Reference pricing -- public API prices for major providers.

Used to show consumers how IE exchange prices compare to centralized APIs.
All prices are $/million tokens (Mtok), publicly available from each provider's
pricing page. Updated manually as pricing changes.

Sources:
- OpenAI: https://openai.com/api/pricing/
- Anthropic: https://anthropic.com/pricing
- Google: https://ai.google.dev/pricing
- Together AI: https://www.together.ai/pricing
- OpenRouter: https://openrouter.ai/models
"""

# Model family -> list of reference prices
# Each entry: (provider, model_name, input_price, output_price)
REFERENCE_PRICES: dict[str, list[dict]] = {
    # Llama family
    "llama": [
        {"provider": "OpenAI", "model": "gpt-4o-mini", "input": 0.15, "output": 0.60, "note": "closest capability"},
        {"provider": "Anthropic", "model": "claude-3.5-haiku", "input": 0.80, "output": 4.00, "note": "closest capability"},
        {"provider": "Together AI", "model": "llama-3.1-8b", "input": 0.18, "output": 0.18},
        {"provider": "OpenRouter", "model": "llama-3.1-8b", "input": 0.06, "output": 0.06, "note": "cheapest"},
    ],
    # Qwen family
    "qwen": [
        {"provider": "OpenAI", "model": "gpt-4o-mini", "input": 0.15, "output": 0.60, "note": "closest capability"},
        {"provider": "Together AI", "model": "qwen-2.5-7b", "input": 0.20, "output": 0.20},
        {"provider": "OpenRouter", "model": "qwen-2.5-7b", "input": 0.05, "output": 0.05, "note": "cheapest"},
    ],
    # Mistral family
    "mistral": [
        {"provider": "Mistral AI", "model": "mistral-small", "input": 0.10, "output": 0.30},
        {"provider": "OpenAI", "model": "gpt-4o-mini", "input": 0.15, "output": 0.60},
        {"provider": "OpenRouter", "model": "mistral-7b", "input": 0.06, "output": 0.06, "note": "cheapest"},
    ],
    # Gemma family
    "gemma": [
        {"provider": "Google", "model": "gemini-1.5-flash", "input": 0.075, "output": 0.30},
        {"provider": "Together AI", "model": "gemma-2-9b", "input": 0.20, "output": 0.20},
    ],
    # Generic / unknown
    "_default": [
        {"provider": "OpenAI", "model": "gpt-4o-mini", "input": 0.15, "output": 0.60},
        {"provider": "Anthropic", "model": "claude-3.5-haiku", "input": 0.80, "output": 4.00},
        {"provider": "Google", "model": "gemini-1.5-flash", "input": 0.075, "output": 0.30},
    ],
}


def get_reference_prices(model_name: str) -> list[dict]:
    """Get reference prices for a model by matching its family."""
    name_lower = model_name.lower()
    for family, prices in REFERENCE_PRICES.items():
        if family == "_default":
            continue
        if family in name_lower:
            return prices
    return REFERENCE_PRICES["_default"]


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
                "note": ref.get("note", ""),
            })
    return {"comparisons": comparisons, "exchange_price": exchange_price}
