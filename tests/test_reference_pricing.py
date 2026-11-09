from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.comparison_identity import ExactCatalog
from inference_exchange.coordinator.price_collector import PriceEntry
from inference_exchange.coordinator.reference_pricing import get_reference_prices, compute_savings


def test_same_family_and_old_key_never_join_reference_prices(monkeypatch):
    from types import SimpleNamespace
    ids = ["qwen/qwen2.5-7b-instruct", "qwen/qwen3-7b-instruct"]
    entries = [PriceEntry(source="openrouter", model_id=model, display_name=model,
                         family="qwen", family_key="qwen-7b-instruct",
                         input_per_mtok=0.1, output_per_mtok=0.2) for model in ids]
    monkeypatch.setattr(dependencies, "_price_collector", SimpleNamespace(get_all_current=lambda: entries))
    resolver = ExactCatalog([{"id": model, "name": model,
                             "source_ids": [{"source": "openrouter", "model_id": model}]} for model in ids])
    assert [q["model"] for q in get_reference_prices(ids[0], resolver=resolver)] == [ids[0]]
    assert get_reference_prices("ie/p/Local", resolver=resolver) == []
    assert get_reference_prices("Qwen 7B Instruct", resolver=resolver) == []


def test_headline_requires_fresh_matching_quantization_and_context(monkeypatch):
    model = {"id": "catalog/model", "name": "Checkpoint", "offers": [{
        "id": "endpoint", "provider": "Provider", "route": "Direct",
        "input": "0.2", "cache_read": "0.05", "output": "0.6",
        "quantization": "FP16", "context_length": 4096, "comparable": True, "observed_at": 1000,
    }]}
    resolver = ExactCatalog([model])
    monkeypatch.setattr("inference_exchange.coordinator.reference_pricing.time.time", lambda: 1001)
    args = dict(resolver=resolver, quantization="FP16", context_length=4096)
    assert compute_savings(0.15, model["id"], 0.05, 0.01, **args)["comparisons"][0]["diff_pct"] == 75
    assert compute_savings(0.15, model["id"], resolver=resolver,
                           quantization="Q4_K_M", context_length=4096)["comparisons"][0]["diff_pct"] is None
    assert compute_savings(0.15, model["id"], resolver=resolver,
                           quantization="FP16", context_length=8192)["comparisons"][0]["diff_pct"] is None
    monkeypatch.setattr("inference_exchange.coordinator.reference_pricing.time.time", lambda: 100000)
    assert compute_savings(0.15, model["id"], **args)["comparisons"][0]["diff_pct"] is None
