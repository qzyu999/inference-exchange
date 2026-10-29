"""#84: routes cannot bypass Store's shared SQLite read/write synchronization."""
from pathlib import Path

from inference_exchange.coordinator.price_collector import PriceEntry
from inference_exchange.coordinator.store import Store


def test_coordinator_routes_never_access_shared_connection_directly():
    base = Path(__file__).resolve().parents[1] / "inference_exchange" / "coordinator"
    for module in ("routes_auth.py", "routes_exchange.py", "routes_admin.py",
                   "routes_provider.py", "price_collector.py"):
        source = (base / module).read_text(encoding="utf-8")
        assert "store._conn" not in source
        assert "self._store._conn" not in source


def test_store_facing_history_and_admin_earnings_keep_existing_contract(tmp_path):
    store = Store(db_path=tmp_path / "store-routes.db")
    store.get_or_create_account("buyer")
    store.charge_request("r-a", "buyer", "p-a", "model-x", 20, 40, 0.5, 0.5)
    store.charge_request("r-b", "buyer", "p-b", "model-y", 20, 50, 0.5, 0.5)
    mine = store.list_consumer_transactions("buyer", limit=50)
    assert len(mine) == 2
    assert all(x["consumer_id"] == "buyer" for x in mine)
    assert store.list_consumer_transactions("someone-else") == []
    single = store.admin_provider_earnings("p-a")
    assert single["provider_id"] == "p-a"
    assert single["requests_served"] == 1
    billed_a = next(item for item in mine if item["provider_id"] == "p-a")
    assert single["earnings_usd"] == round(billed_a["provider_earning_micro"] / 1_000_000, 6)
    assert store.admin_provider_earnings("missing") == {
        "provider_id": "missing", "earnings_usd": 0, "requests_served": 0,
    }
    all_providers = store.admin_provider_earnings()["providers"]
    assert {x["provider_id"] for x in all_providers} == {"p-a", "p-b"}
    assert sum(x["requests_served"] for x in all_providers) == 2


def test_reference_history_and_dev_reset_write_use_serialized_store(tmp_path):
    store = Store(db_path=tmp_path / "store-prices.db")
    now = 1000.0
    store.save_reference_prices([
        PriceEntry(source="test-source", model_id="model-x", display_name="model-x",
                   family="f", family_key="family-x",
                   input_per_mtok=0.1, output_per_mtok=0.2, fetched_at=now),
    ])
    assert len(store.list_reference_price_history("family-x", 900)) == 1
    assert store.list_reference_price_history("family-x", 1001) == []
    store.get_or_create_account("buyer")
    store.charge_request("r-reset", "buyer", "provider", "m", 1, 1, 0.1, 0.1)
    assert store.get_account("buyer")["total_spent_micro"] > 0
    store.reset_dev_balance("buyer")
    # Reset is intentionally only the balance, not spent/earned history.
    assert store.get_account("buyer")["balance_micro"] == 10_000_000
    assert store.get_account("buyer")["total_spent_micro"] > 0
