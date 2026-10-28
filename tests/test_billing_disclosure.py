"""BILL-009 (#122): billing amounts are exact and the minimum charge is disclosed."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import MIN_CHARGE_MICRO


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    c = TestClient(create_app())
    raw, cid = dependencies.get_store().create_api_key("billing-ui")
    c.headers["authorization"] = f"Bearer {raw}"
    return c, cid


def _history(c):
    return c.get("/v1/exchange/history").json()["transactions"]


def test_billing_config_discloses_minimum(client):
    c, _ = client
    cfg = c.get("/v1/exchange/billing-config").json()
    assert cfg["minimum_charge_micro"] == MIN_CHARGE_MICRO == 100
    assert cfg["minimum_charge_usd"] == 0.0001
    assert cfg["platform_fee_percent"] == 10
    assert cfg["simulated_credits"] is True


def test_history_marks_minimum_and_has_exact_split(client):
    c, cid = client
    store = dependencies.get_store()
    store.charge_request("req-tiny-0001", cid, "p1", "m", 5, 3, 0.05, 0.15)       # token cost < minimum
    store.charge_request("req-big-00001", cid, "p1", "m", 100_000, 50_000, 1.0, 2.0)  # token cost > minimum
    rows = {t["request_id"]: t for t in _history(c)}
    tiny, big = rows["req-tiny"], rows["req-big-"]
    assert tiny["minimum_applied"] is True and tiny["cost_micro"] == 100
    assert big["minimum_applied"] is False and big["cost_micro"] > 100
    for t in (tiny, big):
        assert t["cost_micro"] == t["provider_earning_micro"] + t["platform_fee_micro"]
        assert t["cost_usd"] == t["cost_micro"] / 1_000_000


def test_accumulated_microcharges_reconcile_with_balance(client):
    c, cid = client
    store = dependencies.get_store()
    before = c.get("/v1/exchange/balance").json()
    n = 37
    for i in range(n):
        store.charge_request(f"req-{i:04d}-x", cid, "p1", "m", 1, 1, 0.01, 0.01)
    after = c.get("/v1/exchange/balance").json()
    listed = sum(t["cost_micro"] for t in _history(c))
    assert listed == n * MIN_CHARGE_MICRO
    # Sum of charges == spent delta == balance delta, in exact micro-USD
    assert round((after["total_spent_usd"] - before["total_spent_usd"]) * 1_000_000) == listed
    assert round((before["balance_usd"] - after["balance_usd"]) * 1_000_000) == listed
    # A $0.0037 spend must not be rounded away (the old UI showed $0.00)
    assert after["total_spent_usd"] == pytest.approx(0.0037)
