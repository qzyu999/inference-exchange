"""PROV-016/017, PRIV-007: stable provider ownership and additive legacy claims (#150).

All tests use disposable SQLite files. Never use live coordinator data.
"""
import hashlib
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import (
    ProviderOwnershipError, SCHEMA, Store,
)
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage


ADMIN = "admin@example.com"


def _registration(name="m6-mini"):
    return RegisterMessage(
        provider_name=name,
        capabilities=ProviderCapabilities(
            models=["mock"], hardware="apple-m6", model_format="gguf",
        ),
    ).model_dump()


@pytest.fixture
def env(monkeypatch, tmp_path):
    path = tmp_path / "ownership.db"
    monkeypatch.setenv("IE_DB_PATH", str(path))
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "ownership-test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", ADMIN)
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    monkeypatch.delenv("IE_SIGNUP_DISABLED", raising=False)
    return path


@pytest.fixture
def setup(env):
    root = TestClient(create_app(), base_url="https://testserver")
    admin = TestClient(root.app, base_url="https://testserver")
    res = admin.post("/v1/auth/signup", json={"email": ADMIN, "password": "hunter22"})
    assert res.status_code == 200, res.text
    store = dependencies.get_store()
    owner_a, _ = store.upsert_github_user("10001", "alice", "alice@example.com", "Alice")
    owner_b, _ = store.upsert_github_user("10002", "bob", "bob@example.com", "Bob")
    return root, admin, store, owner_a, owner_b


def _token(admin, store, name="mini"):
    resp = admin.post("/v1/admin/provider-tokens", json={"name": name})
    assert resp.status_code == 200, resp.text
    raw = resp.json()["token"]
    return raw, store.validate_provider_token(raw)["billing_account_id"]


def _claim(admin, principal, owner, reason="Owner verified offline"):
    return admin.post("/v1/admin/provider-claims", json={
        "billing_account_id": principal, "owner_user_id": owner["user_id"],
        "reason": reason,
    })


def _connect(client, token):
    return client.websocket_connect(
        "/ws/provider", headers={"Authorization": "Bearer " + token},
    )


def test_claim_preserves_principal_and_allows_multiple_nodes(setup):
    root, admin, store, alice, bob = setup
    t1, p1 = _token(admin, store)
    t2, p2 = _token(admin, store)
    store.get_or_create_account("test-customer")
    bill = store.charge_request("past", "test-customer", p1, "mock", 10, 20, 1.0, 1.0)
    before_token = dict(store._conn.execute(
        "SELECT token_hash, billing_account_id, revoked_at FROM provider_tokens WHERE billing_account_id = ?",
        (p1,),
    ).fetchone())
    before_balances = {a: store.get_account(a) for a in ("test-customer", p1)}
    before_tx = [dict(row) for row in store._conn.execute("SELECT * FROM transactions")]
    claimed = _claim(admin, p1, alice)
    assert claimed.status_code == 200, claimed.text
    node1 = claimed.json()["node"]
    assert node1["billing_account_id"] == p1 and node1["owner_user_id"] == alice["user_id"]
    second = _claim(admin, p2, alice)
    assert second.status_code == 200
    assert second.json()["node"]["node_id"] != node1["node_id"]
    assert store.provider_billing_principals_for_owner(alice["user_id"]) == {p1, p2}
    assert store.provider_billing_principals_for_owner(bob["user_id"]) == set()
    with _connect(root, t1) as ws:
        ws.send_json(_registration())
        pid = ws.receive_json()["provider_id"]
        assert dependencies.get_hub()._providers[pid].billing_account_id == p1
    assert store.validate_provider_token(t1)["billing_account_id"] == p1
    assert store.validate_provider_token(t2)["billing_account_id"] == p2
    assert {a: store.get_account(a) for a in before_balances} == before_balances
    assert [dict(row) for row in store._conn.execute("SELECT * FROM transactions")] == before_tx
    assert dict(store._conn.execute(
        "SELECT token_hash, billing_account_id, revoked_at FROM provider_tokens WHERE billing_account_id = ?",
        (p1,),
    ).fetchone()) == before_token
    audit = [dict(row) for row in store._conn.execute("SELECT * FROM provider_ownership_actions")]
    assert len(audit) == 2 and all(row["action"] == "claim" for row in audit)
    assert all(row["actor_user_id"] for row in audit)
    assert bill["cost_micro"] == bill["provider_earning_micro"] + bill["platform_fee_micro"]


def test_claim_denied_for_unauthorized_or_invalid_owner(setup):
    root, admin, store, alice, bob = setup
    raw, principal = _token(admin, store)
    body = {"billing_account_id": principal, "owner_user_id": alice["user_id"], "reason": "verify"}
    anon = TestClient(root.app, base_url="https://testserver")
    assert anon.post("/v1/admin/provider-claims", json=body).status_code in (401, 403)
    nonadmin = TestClient(root.app, base_url="https://testserver")
    assert nonadmin.post("/v1/auth/signup", json={
        "email": "ordinary@example.com", "password": "hunter22",
    }).status_code == 200
    assert nonadmin.post("/v1/admin/provider-claims", json=body).status_code == 403
    assert _claim(admin, principal, {"user_id": "missing"}).status_code == 404
    assert _claim(admin, "provider-acct-absent", alice).status_code == 404
    assert _claim(admin, principal, alice, reason="  ").status_code == 400
    password_only = store.create_user("password@example.com", "hunter22", "Legacy")
    assert _claim(admin, principal, password_only).status_code == 409
    assert store.suspend_user(alice["user_id"], "test", "admin", None)
    assert _claim(admin, principal, alice).status_code == 409
    assert store.unsuspend_user(alice["user_id"], "restore", "admin")
    assert _claim(admin, principal, alice).status_code == 200
    assert _claim(admin, principal, bob).status_code == 409
    assert _claim(admin, principal, alice).status_code == 409
    assert store.validate_provider_token(raw)["billing_account_id"] == principal
    assert store.provider_billing_principals_for_owner(alice["user_id"]) == {principal}
    assert store.provider_billing_principals_for_owner(bob["user_id"]) == set()
    revoked, revoked_principal = _token(admin, store, "revoked")
    token_id = store.validate_provider_token(revoked)["token_id"]
    assert admin.delete("/v1/admin/provider-tokens/" + token_id).status_code == 200
    assert _claim(admin, revoked_principal, alice).status_code == 409


def test_competing_claims_are_atomic(setup):
    root, admin, store, alice, bob = setup
    token, principal = _token(admin, store)
    def attempt(owner):
        try:
            return store.claim_legacy_provider(principal, owner["user_id"],
                                               store._conn.execute(
                                                   "SELECT user_id FROM users WHERE email = ?", (ADMIN,)
                                               ).fetchone()[0], "Verified")
        except ProviderOwnershipError as exc:
            return exc.status_code
    # Independent SQLite connections serialize the entire claim under BEGIN IMMEDIATE.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, (alice, bob)))
    winners = [x for x in results if isinstance(x, dict)]
    assert len(winners) == 1
    assert sorted(x for x in results if isinstance(x, int)) == [409]
    assert store._conn.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0] == 1
    assert store._conn.execute("SELECT COUNT(*) FROM provider_ownership_actions").fetchone()[0] == 1
    assert store.validate_provider_token(token)["billing_account_id"] == principal


def test_owned_token_suspension_disconnects_and_blocks_reconnect(setup):
    root, admin, store, alice, bob = setup
    token, principal = _token(admin, store)
    assert _claim(admin, principal, alice).status_code == 200
    with _connect(root, token) as ws:
        ws.send_json(_registration())
        provider_id = ws.receive_json()["provider_id"]
        assert provider_id in dependencies.get_hub()._providers
        suspended = admin.post("/v1/admin/accounts/" + alice["user_id"] + "/suspend", json={
            "reason": "temporary investigation", "duration_seconds": 60,
        })
        assert suspended.status_code == 200, suspended.text
        assert provider_id not in dependencies.get_hub()._providers
    with pytest.raises(WebSocketDisconnect) as exc:
        with _connect(root, token) as ws:
            ws.receive_text()
    assert exc.value.code == 4003
    assert admin.post("/v1/admin/accounts/" + alice["user_id"] + "/unsuspend",
                      json={"reason": "reviewed"}).status_code == 200
    with _connect(root, token) as ws:
        ws.send_json(_registration())
        assert ws.receive_json()["type"] == "registered"


def test_unclaimed_legacy_token_still_connects(setup):
    root, admin, store, alice, bob = setup
    token, principal = _token(admin, store)
    with _connect(root, token) as ws:
        ws.send_json(_registration())
        provider_id = ws.receive_json()["provider_id"]
        provider = dependencies.get_hub()._providers[provider_id]
        assert provider.billing_account_id == principal
        assert store.validate_provider_token(token)["node_id"] is None


def test_delete_with_provider_nodes_requires_offboarding(setup):
    root, admin, store, alice, bob = setup
    token, principal = _token(admin, store)
    # Use a GitHub user session; the deletion path must not silently orphan the node.
    assert _claim(admin, principal, alice).status_code == 200
    from inference_exchange.coordinator.routes_auth import _set_session
    from fastapi.responses import JSONResponse
    response = JSONResponse({"ok": True})
    # The helper issues a signed cookie for the existing GitHub-linked user.
    _set_session(response, alice)
    client = TestClient(root.app, base_url="https://testserver")
    for cookie in response.headers.getlist("set-cookie"):
        if cookie.startswith("ie_session="):
            client.cookies.set("ie_session", cookie.split(";", 1)[0].split("=", 1)[1])
    deleted = client.delete("/v1/auth/account")
    assert deleted.status_code == 409, deleted.text
    assert deleted.json()["error"]["code"] == "provider_nodes_exist"
    assert store.get_user(alice["user_id"]) is not None
    assert store.validate_provider_token(token)["billing_account_id"] == principal


def test_additive_migration_preserves_existing_ledger_and_unclaimed_token(env):
    """Simulate a pre-PR1 database, then apply the additive migration twice."""
    old_schema = SCHEMA.replace(
        "    node_id TEXT REFERENCES provider_nodes(node_id),\n", "",
    )
    a = old_schema.index("CREATE TABLE IF NOT EXISTS provider_nodes (")
    b = old_schema.index("CREATE TABLE IF NOT EXISTS reference_prices (")
    old_schema = old_schema[:a] + old_schema[b:]
    old_schema = old_schema.replace(
        "CREATE INDEX IF NOT EXISTS idx_provider_nodes_owner ON provider_nodes(owner_user_id);\n", "",
    ).replace(
        "CREATE INDEX IF NOT EXISTS idx_provider_ownership_actions_node ON provider_ownership_actions(node_id, timestamp);\n", "",
    )
    token = "pt-ie-" + "cd" * 16
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    with sqlite3.connect(env) as conn:
        conn.executescript(old_schema)
        conn.execute("INSERT INTO provider_tokens (token_hash, token_id, name, billing_account_id, created_at) VALUES (?, ?, ?, ?, ?)",
                     (token_hash, token_hash[:8], "mini", "provider-acct-old", now))
        for account in ("default-consumer", "consumer", "provider-acct-old", "provider-1"):
            conn.execute("INSERT INTO accounts (account_id, name, balance_micro, total_earned_micro, created_at) VALUES (?, ?, ?, ?, ?)",
                         (account, account, 12_345_678, 333 if account == "provider-1" else 0, now))
        conn.execute("""INSERT INTO transactions (
            request_id, consumer_id, provider_id, model, input_tokens, output_tokens,
            cost_micro, provider_earning_micro, platform_fee_micro, timestamp
        ) VALUES ('old', 'consumer', 'provider-1', 'mock', 10, 20, 100, 90, 10, ?)""", (now,))
        conn.execute("""INSERT INTO provider_history
            (provider_id, provider_account_id, session_id, provider_name, connected_at)
            VALUES ('provider-1', NULL, NULL, 'legacy', ?)""", (now,))
        accounts_before = conn.execute("SELECT * FROM accounts ORDER BY account_id").fetchall()
        tx_before = conn.execute("SELECT * FROM transactions").fetchall()
        history_before = conn.execute("SELECT * FROM provider_history").fetchall()
        token_before = conn.execute("SELECT token_hash, billing_account_id FROM provider_tokens").fetchall()

    first = Store(db_path=env)
    second = Store(db_path=env)
    with sqlite3.connect(env) as conn:
        assert conn.execute("SELECT * FROM accounts ORDER BY account_id").fetchall() == accounts_before
        assert conn.execute("SELECT * FROM transactions").fetchall() == tx_before
        assert conn.execute("SELECT * FROM provider_history").fetchall() == history_before
        assert conn.execute("SELECT token_hash, billing_account_id FROM provider_tokens").fetchall() == token_before
        assert conn.execute("SELECT node_id FROM provider_tokens").fetchone()[0] is None
        assert conn.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM provider_ownership_actions").fetchone()[0] == 0
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert first.validate_provider_token(token)["billing_account_id"] == "provider-acct-old"
    assert second.validate_provider_token(token)["node_id"] is None
