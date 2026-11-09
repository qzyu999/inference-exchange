import json
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.price_collector import OpenRouterFetcher
from test_comparison_identity import make_provider


def test_legacy_reference_route_keeps_catalog_quotes_out_of_provider_counts(monkeypatch):
    client = TestClient(create_app())
    quotes = OpenRouterFetcher._parse_models([{
        "id": "qwen/model", "name": "Model",
        "pricing": {"prompt": "0", "completion": "0.0000001"},
    }])
    monkeypatch.setattr(dependencies, "_price_collector", SimpleNamespace(
        get_all_current=lambda: quotes, get_sources_metadata=lambda: {},
    ))
    models = client.get("/v1/exchange/reference-prices").json()["models"]
    assert len(models) == 1
    assert models[0]["provider_count"] == 0
    assert models[0]["prices"][0]["quote_kind"] == "catalog"
    assert models[0]["prices"][0]["price_output"] == 0.1


def test_two_reviewed_aliases_keep_offers_but_count_one_ie_provider(monkeypatch):
    client = TestClient(create_app())
    now = time.time()
    data = {"schema_version": 1, "generation": 1, "generated_at": now, "models": [{
        "id": "catalog/checkpoint", "name": "Checkpoint", "aliases": ["A", "B"], "offers": [],
    }]}
    client.app.state.ticker_cache.install(json.dumps(data).encode(), None, now=now)
    provider = make_provider(models=["A", "B"])
    monkeypatch.setattr(dependencies, "_hub", SimpleNamespace(_providers={"p": provider}))
    market = client.get("/v1/exchange/market").json()["models"][0]
    assert market["provider_count"] == 1
    assert len(market["providers"]) == 2
    assert {p["original_model"] for p in market["providers"]} == {"A", "B"}
    catalog = client.get("/v1/exchange/catalog").json()["models"][0]
    assert catalog["provider_count"] == 1
    assert len(catalog["offers"]) == 2
    assert client.get("/v1/exchange/reference-prices").json()["models"][0]["provider_count"] == 1


def test_ie_cache_sentinel_is_not_a_free_cache_quote(monkeypatch):
    client = TestClient(create_app())
    now = time.time()
    data = {"schema_version": 1, "generation": 1, "generated_at": now, "models": [{
        "id": "catalog/checkpoint", "name": "Checkpoint", "aliases": ["Local"], "offers": [{
            "id": "endpoint", "provider": "External", "route": "Direct", "quote_kind": "endpoint",
            "source_url": "https://example.com/prices", "observed_at": now,
            "input": "0.2", "cache_read": "0.05", "output": "0.6",
            "quantization": "FP16", "context_length": 4096, "comparable": True,
        }],
    }]}
    client.app.state.ticker_cache.install(json.dumps(data).encode(), None, now=now)
    provider = make_provider(models=["Local"])
    provider.model_identity = {"name": "Local", "quantization": "FP16"}
    provider.capabilities.price_per_mtok_cache = 0  # Billing uses the input rate.
    provider.capabilities.price_per_mtok_output = 0.15
    monkeypatch.setattr(dependencies, "_hub", SimpleNamespace(_providers={"p": provider}))
    catalog = client.get("/v1/exchange/catalog").json()["models"][0]
    assert catalog["offers"][-1]["cache_read"] is None
    market = client.get("/v1/exchange/market").json()["models"][0]
    assert market["providers"][0]["price_cache"] == 0
    assert market["reference_prices"][0]["diff_pct"] == 75
    assert market["reference_prices"][0]["diff_cache_pct"] is None
