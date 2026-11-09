"""Reference quotes selected through the catalog's exact comparison resolver."""
import time

from .ticker_catalog import FRESH_SECONDS


def get_reference_prices(comparison_id, *, resolver=None):
    if resolver is None or comparison_id not in resolver.ids:
        return []
    model = resolver.models[comparison_id]
    offers = model.get("offers", [])
    if offers:
        return [{
            "provider": o["provider"] + " via " + o["route"], "model": model["name"],
            "input": float(o["input"]) if o.get("input") is not None else 0,
            "output": float(o["output"]) if o.get("output") is not None else 0,
            "cache": float(o["cache_read"]) if o.get("cache_read") is not None else 0,
            "comparison_type": "same_model", "quantization": o.get("quantization"),
            "context_length": o.get("context_length"),
            "comparable": o.get("comparable", False) and o.get("quote_kind", "endpoint") == "endpoint",
            "fresh": time.time() - o["observed_at"] <= FRESH_SECONDS,
        } for o in offers]
    from .dependencies import get_price_collector
    collector = get_price_collector()
    return [{
        "provider": e.source, "model": e.display_name,
        "input": e.input_per_mtok, "output": e.output_per_mtok, "cache": e.cache_per_mtok,
        "comparison_type": "same_model", "quantization": e.quantization,
        "context_length": e.context_length, "comparable": e.quote_kind == "endpoint",
        "fresh": time.time() - e.fetched_at <= FRESH_SECONDS,
    } for e in (collector.get_all_current() if collector else [])
        if resolver.source(e.source, e.model_id) == comparison_id]


def compute_savings(exchange_price, comparison_id, exchange_input=0, exchange_cache=0,
                    *, resolver=None, quantization=None, context_length=None):
    comparisons = []
    for ref in get_reference_prices(comparison_id, resolver=resolver):
        eligible = bool(ref["fresh"] and ref["comparable"] and quantization and ref["quantization"]
                        and quantization.casefold() == ref["quantization"].casefold()
                        and context_length and context_length == ref["context_length"])
        def difference(local, external):
            return round((1 - local / external) * 100) if eligible and external > 0 else None
        out = difference(exchange_price, ref["output"])
        comparisons.append({
            "provider": ref["provider"], "model": ref["model"],
            "price_input": ref["input"], "price_cache": ref["cache"], "price_output": ref["output"],
            "diff_pct": out, "diff_input_pct": difference(exchange_input, ref["input"]),
            "diff_cache_pct": difference(exchange_cache, ref["cache"]) if exchange_cache > 0 else None,
            "cheaper": out is not None and out > 0, "comparison_type": ref["comparison_type"],
        })
    return {"comparisons": comparisons, "exchange_price": exchange_price,
            "exchange_input": exchange_input, "exchange_cache": exchange_cache}
