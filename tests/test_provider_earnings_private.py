"""BILL-011, PRIV-009: owner-scoped provider income is private and exact (#152)."""

import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.routes_auth import _session_token
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "private-earnings.db"))
    monkeypatch.setenv("IE_JWT_SECRET", "private-earnings-test-secret")
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    root = TestClient(create_app(), base_url="https://testserver")
    store = dependencies.get_store()
    alice, _ = store.upsert_github_user("2001", "alice", "alice@example.com", "Alice")
    bob, _ = store.upsert_github_user("2002", "bob", "bob@example.com", "Bob")
    third, _ = store.upsert_github_user("2003", "third", "third@example.com", "Third")
    admin, _ = store.upsert_github_user("2004", "admin", "admin@example.com", "Admin")
    owner_keys = {}
    for user in (alice, bob, third):
        owner_keys[user["user_id"]] = {"Authorization": "Bearer " + _session_token(user)}
    return root, store, alice, bob, third, admin, owner_keys


def _claim(store, admin, owner, name):
    token = store.create_provider_token(name)
    principal = store.validate_provider_token(token)["billing_account_id"]
    node = store.claim_legacy_provider(principal, owner["user_id"], admin["user_id"], "Test ownership")
    return token, principal, node


def _get(root, url, keys):
    return root.get(url, headers=keys)


def _register(name="same-name"):
    return RegisterMessage(
        provider_name=name, capabilities=ProviderCapabilities(
            models=["mock"], hardware="apple-m6", model_format="gguf",
        ),
    ).model_dump()


def test_multi_node_exact_earnings_and_pagination(setup):
    root, store, alice, bob, third, admin, keys = setup
    _, pa, node_a = _claim(store, admin, alice, "shared-name")
    _, pb, node_b = _claim(store, admin, alice, "shared-name")
    _, pc, node_c = _claim(store, admin, bob, "shared-name")
    # Unclaimed token and legacy WebSocket balances must never be included.
    legacy_token = store.create_provider_token("shared-name")
    unclaimed = store.validate_provider_token(legacy_token)["billing_account_id"]
    store.get_or_create_account("buyer")
    reqs = [(pa, "r1"), (pb, "r2"), (pc, "r3"), (pa, "r4"), (unclaimed, "r5"), ("provider-1", "r6")]
    for principal, rid in reqs:
        bill = store.charge_request(rid, "buyer", principal, "mock", 25, 50, 0.05, 0.15)
        assert (bill["cost_micro"], bill["provider_earning_micro"], bill["platform_fee_micro"]) == (100, 90, 10)

    response = _get(root, "/v1/provider/earnings?limit=2", keys[alice["user_id"]])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["unit"] == "micro_usd" and body["simulated_credits"] is True
    assert body["summary"] == {
        "earned_micro": 270, "ledger_earned_micro": 270,
        "today_earned_micro": 270, "cost_micro": 300,
        "platform_fee_micro": 30, "requests_served": 3, "reconciled": True,
    }
    assert len(body["by_node"]) == 2
    assert body["next_before_id"] is not None
    ids = [t["id"] for t in body["transactions"]]
    page2 = _get(root, "/v1/provider/earnings?limit=2&before_id=" + str(body["next_before_id"]), keys[alice["user_id"]]).json()
    assert len(page2["transactions"]) == 1
    ids += [t["id"] for t in page2["transactions"]]
    assert len(set(ids)) == 3
    assert all("consumer_id" not in t and "request_id" not in t for t in body["transactions"] + page2["transactions"])
    assert all(t["cost_micro"] == t["provider_earning_micro"] + t["platform_fee_micro"] for t in body["transactions"])
    scoped = _get(root, "/v1/provider/earnings?node_id=" + node_a["node_id"], keys[alice["user_id"]]).json()
    assert scoped["summary"]["earned_micro"] == 180
    assert {t["node_id"] for t in scoped["transactions"]} == {node_a["node_id"]}
    assert _get(root, "/v1/provider/earnings", keys[bob["user_id"]]).json()["summary"]["earned_micro"] == 90
    assert _get(root, "/v1/provider/earnings", keys[third["user_id"]]).json()["summary"]["earned_micro"] == 0


def test_balance_grant_not_counted_as_earnings_and_reconciliation(setup):
    root, store, alice, bob, third, admin, keys = setup
    token, principal, node = _claim(store, admin, alice, "mini")
    store.get_or_create_account(principal)
    empty = _get(root, "/v1/provider/earnings", keys[alice["user_id"]]).json()
    assert empty["summary"]["earned_micro"] == 0
    assert empty["summary"]["ledger_earned_micro"] == 0
    assert empty["summary"]["reconciled"]
    assert store.get_account(principal)["balance_micro"] == 10_000_000
    store.get_or_create_account("buyer")
    store.charge_request("req-1", "buyer", principal, "mock", 12, 14, 0.05, 0.15)
    store._conn.execute("UPDATE accounts SET total_earned_micro = total_earned_micro + 7 WHERE account_id = ?", (principal,))
    store._conn.commit()
    mismatch = _get(root, "/v1/provider/earnings", keys[alice["user_id"]]).json()
    assert mismatch["summary"]["earned_micro"] == 90
    assert mismatch["summary"]["ledger_earned_micro"] == 97
    assert mismatch["summary"]["reconciled"] is False
    assert mismatch["by_node"][0]["reconciled"] is False


def test_cross_owner_and_anonymous_requests_fail_closed(setup):
    root, store, alice, bob, third, admin, keys = setup
    _, pa, node_a = _claim(store, admin, alice, "same-name")
    _, pb, node_b = _claim(store, admin, bob, "same-name")
    store.get_or_create_account("buyer")
    store.charge_request("alice", "buyer", pa, "mock", 1, 1, 1.0, 1.0)
    store.charge_request("bob", "buyer", pb, "mock", 1, 1, 1.0, 1.0)
    for url in ("/v1/provider/nodes", "/v1/provider/earnings"):
        assert root.get(url).status_code == 401
        assert root.get(url, headers={"Authorization": "Bearer invalid"}).status_code == 401
        assert root.get(url, headers={"Authorization": "Bearer pt-ie-not-a-jwt"}).status_code == 401
        assert root.get(url, headers={"Authorization": "Bearer " + store.create_api_key_for_user(alice["user_id"], "no-provider-access")}).status_code == 401
    nodes_a = _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).json()["nodes"]
    assert [n["node_id"] for n in nodes_a] == [node_a["node_id"]]
    assert _get(root, "/v1/provider/nodes", keys[bob["user_id"]]).json()["nodes"][0]["node_id"] == node_b["node_id"]
    foreign = "/v1/provider/earnings?node_id=" + node_a["node_id"]
    assert _get(root, foreign, keys[bob["user_id"]]).status_code == 404
    assert _get(root, "/v1/provider/earnings?node_id=node-random", keys[bob["user_id"]]).status_code == 404
    assert _get(root, "/v1/provider/earnings", keys[alice["user_id"]]).json()["summary"]["requests_served"] == 1


def test_revoked_suspended_and_bad_sessions_fail_closed(setup):
    root, store, alice, bob, third, admin, keys = setup
    _, principal, node = _claim(store, admin, alice, "mini")
    assert _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).status_code == 200
    old = keys[alice["user_id"]]
    store.bump_session_version(alice["user_id"])
    assert _get(root, "/v1/provider/nodes", old).status_code == 401
    # A newly minted, valid session token for a suspended user gets a 403.
    assert store.suspend_user(alice["user_id"], "abuse", admin["user_id"], None)
    new_session = {"Authorization": "Bearer " + _session_token(
        {**alice, "session_version": store.get_session_version(alice["user_id"])}
    )}
    assert _get(root, "/v1/provider/nodes", new_session).status_code == 403
    assert _get(root, "/v1/provider/earnings", new_session).status_code == 403


def test_owned_node_status_and_secret_redaction(setup):
    root, store, alice, bob, third, admin, keys = setup
    token, principal, node = _claim(store, admin, alice, "M6")
    before = _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).json()
    assert before["nodes"][0]["status"] == "offline"
    assert before["nodes"][0]["last_heartbeat"] is None
    assert "billing_account_id" not in before["nodes"][0]
    with root.websocket_connect("/ws/provider", headers={"Authorization": "Bearer " + token}) as ws:
        ws.send_json(_register())
        pid = ws.receive_json()["provider_id"]
        connected = _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).json()
        item = connected["nodes"][0]
        assert item["status"] == "online" and item["active_connections"] == 1
        assert item["hardware_claim"] == "apple-m6"
        assert item["claimed_trust_level"] == "open"
        assert item["verified_trust_level"] is None
        assert item["models"] == ["mock"]
        assert "token_hash" not in str(connected) and token not in str(connected)
        # Busy is derived from observed live in-flight request count, not made up.
        dependencies.get_hub()._providers[pid].active_requests = 1
        assert _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).json()["nodes"][0]["status"] == "busy"
    assert _get(root, "/v1/provider/nodes", keys[alice["user_id"]]).json()["nodes"][0]["status"] == "offline"


def test_pagination_bounds_and_empty_history(setup):
    root, store, alice, bob, third, admin, keys = setup
    clean = _get(root, "/v1/provider/earnings", keys[third["user_id"]])
    assert clean.status_code == 200
    assert clean.json()["by_node"] == []
    assert clean.json()["transactions"] == []
    assert clean.json()["next_before_id"] is None
    for bad in ("limit=0", "limit=101", "before_id=0"):
        assert _get(root, "/v1/provider/earnings?" + bad, keys[third["user_id"]]).status_code == 422
