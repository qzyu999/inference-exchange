import time

import pytest
from inference_exchange.coordinator.comparison_identity import ExactCatalog, AmbiguousHistory
from inference_exchange.coordinator.price_collector import PriceEntry
from inference_exchange.coordinator.store import Store
from inference_exchange.coordinator.reference_history import history_response


IDS = ["qwen/qwen2.5-7b-instruct", "qwen/qwen3-7b-instruct"]


def catalog(generation=9, allow_repository_reports=True):
    return ExactCatalog([{"id": model, "name": model, "source_ids": [
        {"source": "openrouter", "model_id": model},
    ]} for model in IDS], generation=generation, allow_repository_reports=allow_repository_reports)


def entries(now=1000):
    return [
        PriceEntry(source="openrouter", model_id=IDS[0], display_name="Qwen2.5",
                   family="qwen", family_key="qwen-7b-instruct", fetched_at=now,
                   input_per_mtok=0, output_per_mtok=0.1),
        PriceEntry(source="openrouter", model_id=IDS[1], display_name="Qwen3",
                   family="qwen", family_key="qwen-7b-instruct", fetched_at=now,
                   input_per_mtok=0, output_per_mtok=0.2),
        PriceEntry(source="openrouter", model_id=IDS[0], display_name="Qwen2.5",
                   family="", family_key="new-facet-key", fetched_at=now + 86400,
                   input_per_mtok=0, output_per_mtok=0.15),
    ]


def test_parser_changes_keep_durable_history_separate_and_index_repeatable(tmp_path):
    path = tmp_path / "prices.db"
    first = Store(path)
    first.save_reference_prices(entries())
    before = [tuple(row) for row in first._conn.execute("SELECT * FROM reference_prices")]
    balance = first.get_account("default-consumer")["balance_micro"]
    first._conn.close()
    for _ in range(2):
        reopened = Store(path)
        assert [tuple(row) for row in reopened._conn.execute("SELECT * FROM reference_prices")] == before
        assert reopened.get_account("default-consumer")["balance_micro"] == balance
        index = reopened._conn.execute("PRAGMA index_info(idx_ref_source_model_time)").fetchall()
        assert [r[2] for r in index] == ["source", "model_id", "fetched_at"]
        rows = reopened.exact_reference_price_history(catalog(), 0, model=IDS[0])
        assert [r["output_per_mtok"] for r in rows] == [0.1, 0.15]
        assert {r["model_id"] for r in rows} == {IDS[0]}
        assert reopened.exact_reference_price_history(catalog(), 0, legacy_key="new-facet-key") == rows
        with pytest.raises(AmbiguousHistory):
            reopened.exact_reference_price_history(catalog(), 0, legacy_key="qwen-7b-instruct")
        raw = reopened.exact_reference_price_history(catalog(), 0, raw_source=("openrouter", IDS[0]))
        assert raw == rows
        reopened._conn.close()


def test_history_routes_return_choices_for_mixed_legacy_keys(tmp_path, monkeypatch):
    import json
    from fastapi.testclient import TestClient
    from inference_exchange.coordinator.main import create_app
    from inference_exchange.coordinator import dependencies
    from inference_exchange.coordinator.ticker_catalog import SnapshotCache
    now = time.time()
    store = Store(tmp_path / "routes.db")
    store.save_reference_prices(entries(now - 2 * 86400))
    client = TestClient(create_app())
    cache = SnapshotCache(tmp_path / "cache.json")
    data = {"schema_version": 1, "generation": 9, "generated_at": now,
            "models": [{"id": model, "name": model, "offers": [],
                        "source_ids": [{"source": "openrouter", "model_id": model}]} for model in IDS]}
    cache.install(json.dumps(data).encode(), None, now=now)
    client.app.state.ticker_cache = cache
    monkeypatch.setattr(dependencies, "_store", store)
    response = client.get("/v1/exchange/reference-prices/history?family_key=qwen-7b-instruct")
    assert response.status_code == 409
    assert response.json()["detail"]["choices"] == [{"model": model} for model in IDS]
    response = client.get("/v1/exchange/reference-prices/history", params={"model": IDS[0], "days": 999})
    assert response.status_code == 200
    data = response.json()
    assert data["generation"] == 9 and data["days"] == 90
    assert len(data["series"]) == 1
    assert [p["output"] for p in data["series"][0]["points"]] == [0.1, 0.15]
    assert len(data["history"]) == 2
    assert client.get("/v1/exchange/reference-prices/history", params={"source": "openrouter", "model_id": IDS[1]}).json()["series"][0]["model_id"] == IDS[1]
    assert client.get("/v1/exchange/reference-prices/history", params={"model": IDS[0], "family_key": "old"}).status_code == 400
    assert client.get("/v1/exchange/reference-prices/history?source=openrouter").status_code == 400
    assert client.get("/v1/exchange/reference-prices/history?model=missing").status_code == 404


def test_one_comparison_keeps_distinct_raw_source_series_and_rollback_history(tmp_path):
    store = Store(tmp_path / "series.db")
    group = ExactCatalog([{"id": "catalog/checkpoint", "source_ids": [
        {"source": "provider-a", "model_id": "model-a"},
        {"source": "provider-b", "model_id": "model-b"},
    ]}], generation=12, allow_repository_reports=False)
    store.save_reference_prices([
        PriceEntry(source=source, model_id=model, display_name=model, family="f", family_key="old",
                   fetched_at=1000, input_per_mtok=0, output_per_mtok=price)
        for source, model, price in [("provider-a", "model-a", 0.1), ("provider-b", "model-b", 0.2)]
    ])
    rows = store.exact_reference_price_history(group, 0, model="catalog/checkpoint")
    response = history_response(rows, generation=group.generation, days=30)
    assert response["generation"] == 12
    assert len(response["series"]) == 2
    assert len(response["history"][0]["prices"]) == 2
    assert {s["points"][0]["output"] for s in response["series"]} == {0.1, 0.2}
    store._conn.close()
