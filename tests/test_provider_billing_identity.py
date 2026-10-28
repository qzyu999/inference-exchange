"""#136: provider earnings follow authenticated credentials, not WebSocket IDs.

All tests use temporary SQLite files. Never touch the live MBP A database.
"""
import sqlite3
import hashlib
import time

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import Store, SCHEMA
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage


def _register(name="m6-mac-mini"):
    return RegisterMessage(
        provider_name=name, capabilities=ProviderCapabilities(models=["mock"], hardware="apple-m6", model_format="gguf"),
    ).model_dump()


def _connect(client, token):
    """Return a context manager; caller must use 'with' to close the session."""
    return client.websocket_connect("/ws/provider", headers={
        "Authorization": f"Bearer {token}",
    })


@pytest.fixture()
def db(monkeypatch, tmp_path):
    path = tmp_path / "provider-principals.sqlite"
    monkeypatch.setenv("IE_DB_PATH", str(path))
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "test-principal-secret")
    return path


def test_credential_principal_survives_reconnect_and_restart(db):
    store = Store(db_path=db)
    token = store.create_provider_token("m6-mac-mini")
    expected = store.validate_provider_token(token)["billing_account_id"]
    assert expected.startswith("provider-acct-")
    assert expected != "provider-1"

    with TestClient(create_app(), base_url="https://testserver") as app:
        with _connect(app, token) as ws:
            ws.send_json(_register())
            first = ws.receive_json()["provider_id"]
            current = dependencies.get_hub()._providers[first]
            session1 = current.session_id
            assert current.billing_account_id == expected
        with _connect(app, token) as ws:
            ws.send_json(_register())
            second = ws.receive_json()["provider_id"]
            current = dependencies.get_hub()._providers[second]
            session2 = current.session_id
            assert second != first
            assert session2 != session1
            assert current.billing_account_id == expected

    # A restarted coordinator reuses provider-1, but not the billing principal.
    with TestClient(create_app(), base_url="https://testserver") as app:
        with _connect(app, token) as ws:
            ws.send_json(_register())
            restarted = ws.receive_json()["provider_id"]
            current = dependencies.get_hub()._providers[restarted]
            assert restarted == first
            assert current.billing_account_id == expected
            assert current.session_id not in (session1, session2)

    store2 = Store(db_path=db)
    history = store2._conn.execute(
        "SELECT provider_account_id, session_id, disconnected_at FROM provider_history WHERE provider_account_id = ?",
        (expected,),
    ).fetchall()
    assert len(history) == 3
    assert len({row["session_id"] for row in history}) == 3
    assert all(row["disconnected_at"] is not None for row in history)


def test_two_credentials_same_display_name_never_cross_credit(db):
    store = Store(db_path=db)
    one = store.create_provider_token("same-name")
    two = store.create_provider_token("same-name")
    a = store.validate_provider_token(one)["billing_account_id"]
    b = store.validate_provider_token(two)["billing_account_id"]
    assert a != b

    consumer = store.get_or_create_account("customer", "Customer")
    before = consumer["balance_micro"]
    sessions = {}
    with TestClient(create_app(), base_url="https://testserver") as app:
        with _connect(app, two) as ws2:
            ws2.send_json(_register("same-name"))
            pid2 = ws2.receive_json()["provider_id"]
            p2 = dependencies.get_hub()._providers[pid2]
            sessions[b] = p2.session_id
            assert p2.billing_account_id == b
        with _connect(app, one) as ws1:
            ws1.send_json(_register("same-name"))
            pid1 = ws1.receive_json()["provider_id"]
            p1 = dependencies.get_hub()._providers[pid1]
            sessions[a] = p1.session_id
            assert p1.billing_account_id == a

    # Explicitly simulate the stored billing calls made after inference finishes.
    bill_a = store.charge_request(
        "req-a", "customer", a, "mock", 1_000, 1_000, 1.0, 2.0,
        provider_name="same-name", connection_id=sessions[a],
    )
    bill_b = store.charge_request(
        "req-b", "customer", b, "mock", 1_000, 1_000, 1.0, 2.0,
        provider_name="same-name", connection_id=sessions[b],
    )
    assert bill_a and bill_b
    assert store.get_account(a)["total_earned_micro"] == bill_a["provider_earning_micro"]
    assert store.get_account(b)["total_earned_micro"] == bill_b["provider_earning_micro"]
    assert before - store.get_account("customer")["balance_micro"] == bill_a["cost_micro"] + bill_b["cost_micro"]
    for bill in (bill_a, bill_b):
        assert bill["cost_micro"] == bill["provider_earning_micro"] + bill["platform_fee_micro"]
    transactions = store._conn.execute(
        "SELECT request_id, provider_id, connection_id FROM transactions ORDER BY request_id"
    ).fetchall()
    assert [(x["request_id"], x["provider_id"], x["connection_id"]) for x in transactions] == [
        ("req-a", a, sessions[a]), ("req-b", b, sessions[b]),
    ]

    # Reordered connections after restart must not swap owners.
    with TestClient(create_app(), base_url="https://testserver") as app:
        with _connect(app, one) as ws1:
            ws1.send_json(_register("same-name"))
            pid1 = ws1.receive_json()["provider_id"]
            assert dependencies.get_hub()._providers[pid1].billing_account_id == a
        with _connect(app, two) as ws2:
            ws2.send_json(_register("same-name"))
            pid2 = ws2.receive_json()["provider_id"]
            assert dependencies.get_hub()._providers[pid2].billing_account_id == b


def test_legacy_migration_is_idempotent_and_preserves_balances(db):
    store = Store(db_path=db)
    token1 = store.create_provider_token("m6-mac-mini")
    token2 = store.create_provider_token("m6-mac-mini")
    original2 = store.validate_provider_token(token2)["billing_account_id"]
    store.get_or_create_account("customer", "Customer")
    store.charge_request("old-1", "customer", "provider-1", "mock", 100, 200, 1.0, 2.0)
    old_balance = store.get_account("provider-1")
    old_transaction = dict(store._conn.execute(
        "SELECT * FROM transactions WHERE request_id='old-1'"
    ).fetchone())

    # Simulate a token row from the old schema. Startup backfills an ID once.
    store._conn.execute(
        "UPDATE provider_tokens SET billing_account_id=NULL WHERE token_hash=?",
        (store._conn.execute("SELECT token_hash FROM provider_tokens WHERE billing_account_id != ?",
                             (original2,)).fetchone()[0],),
    )
    store._conn.commit()
    reopened = Store(db_path=db)
    new_id = reopened.validate_provider_token(token1)["billing_account_id"]
    assert new_id.startswith("provider-acct-")
    assert new_id != original2
    assert reopened.validate_provider_token(token2)["billing_account_id"] == original2
    assert reopened.get_account("provider-1") == old_balance
    assert dict(reopened._conn.execute(
        "SELECT * FROM transactions WHERE request_id='old-1'"
    ).fetchone()) == old_transaction
    third = Store(db_path=db)
    assert third.validate_provider_token(token1)["billing_account_id"] == new_id
    assert third.get_account(new_id) is None  # no new balance from migration alone


def test_revoked_credential_cannot_rebind_or_connect(db):
    store = Store(db_path=db)
    token = store.create_provider_token("same-name")
    principal = store.validate_provider_token(token)["billing_account_id"]
    token_id = store.list_provider_tokens()[0]["token_id"]
    assert store.revoke_provider_token(token_id)
    assert store.validate_provider_token(token) is None
    replacement = store.create_provider_token("same-name")
    assert store.validate_provider_token(replacement)["billing_account_id"] != principal


def test_legacy_accounts_stay_separate_from_new_principals(db):
    store = Store(db_path=db)
    token = store.create_provider_token("provider-1")
    stable_id = store.validate_provider_token(token)["billing_account_id"]
    store.get_or_create_account("provider-1", "Original")
    store.get_or_create_account(stable_id, "New")
    assert stable_id != "provider-1"
    assert store.get_account("provider-1")["total_earned_micro"] == 0
    assert store.get_account(stable_id)["total_earned_micro"] == 0


def test_real_pre136_schema_is_migrated_in_place(db):
    """Create a database that lacks every new #136 column (the live upgrade path)."""
    raw_token = "pt-ie-" + "ab" * 16
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    legacy = (
        SCHEMA
        .replace("    connection_id TEXT NOT NULL DEFAULT '',\n", "")
        .replace("    provider_account_id TEXT,\n", "")
        .replace("    session_id TEXT,\n", "")
        .replace("    billing_account_id TEXT,\n", "")
    )
    assert "connection_id TEXT" not in legacy
    assert "billing_account_id TEXT" not in legacy
    conn = sqlite3.connect(db)
    conn.executescript(legacy)
    conn.execute(
        "INSERT INTO provider_tokens (token_hash, token_id, name, created_at) VALUES (?, ?, ?, ?)",
        (token_hash, token_hash[:8], "original-mini", time.time()),
    )
    conn.execute(
        "INSERT INTO accounts (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)",
        ("provider-1", "Legacy mini", 10_000_321, time.time()),
    )
    conn.commit()
    conn.close()

    upgraded = Store(db_path=db)
    principal = upgraded.validate_provider_token(raw_token)["billing_account_id"]
    assert principal.startswith("provider-acct-")
    assert principal != "provider-1"
    assert upgraded.get_account("provider-1")["balance_micro"] == 10_000_321
    cols = lambda table: {
        row[1] for row in upgraded._conn.execute(f"PRAGMA table_info({table})")
    }
    assert "connection_id" in cols("transactions")
    assert {"session_id", "provider_account_id"} <= cols("provider_history")
    assert "billing_account_id" in cols("provider_tokens")
    assert Store(db_path=db).validate_provider_token(raw_token)["billing_account_id"] == principal
