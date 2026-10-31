"""Coordinator startup must not rotate persisted API credentials.

Tests use disposable SQLite files only; never the production DB.
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import Store


def _table_rows(db_path, name):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(f"SELECT * FROM {name} ORDER BY rowid").fetchall()


@pytest.mark.parametrize("restart_environment", ["dev", "prod"])
def test_restart_preserves_default_and_named_api_keys(
    monkeypatch, tmp_path, restart_environment
):
    db_path = tmp_path / "restart.db"
    monkeypatch.setenv("IE_ENV", "dev")
    first = Store(db_path)
    bootstrap_key = first.default_key
    assert bootstrap_key is not None
    named_key, consumer = first.create_api_key("Keeps working")
    original_keys = _table_rows(db_path, "api_keys")
    original_accounts = _table_rows(db_path, "accounts")
    first._conn.close()

    monkeypatch.setenv("IE_ENV", restart_environment)
    reopened = Store(db_path)
    assert reopened.default_key is None  # raw secret cannot be recovered from its hash
    assert _table_rows(db_path, "api_keys") == original_keys
    assert _table_rows(db_path, "accounts") == original_accounts
    assert reopened.validate_key(bootstrap_key)["consumer_id"] == "default-consumer"
    assert reopened.validate_key(named_key)["consumer_id"] == consumer
    reopened._conn.close()


def test_prod_does_not_mint_shared_default_key(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "production")
    db_path = tmp_path / "prod.db"
    store = Store(db_path)
    assert store.default_key is None
    assert store.list_keys() == []
    store._conn.close()

    reopened = Store(db_path)
    assert reopened.default_key is None
    assert reopened.list_keys() == []
    reopened._conn.close()


def test_restart_preserves_existing_revoked_key_without_replacement(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "dev")
    db_path = tmp_path / "revoked.db"
    store = Store(db_path)
    with store._conn:
        store._conn.execute(
            "UPDATE api_keys SET revoked_at = 1234 WHERE consumer_id = ?",
            ("default-consumer",),
        )
    before = _table_rows(db_path, "api_keys")
    store._conn.close()

    reopened = Store(db_path)
    assert reopened.default_key is None
    assert _table_rows(db_path, "api_keys") == before
    reopened._conn.close()


def test_dev_health_does_not_expose_new_key_after_restart(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    store = Store(tmp_path / "app.db")
    first_key = store.default_key
    assert first_key
    store._conn.close()

    app = create_app()
    with TestClient(app) as client:
        body = client.get("/health?include_key=1").json()
    assert "default_api_key" not in body
    assert "preserved" in body["default_api_key_note"]
    # The key still exists and did not get rotated by create_app().
    with sqlite3.connect(tmp_path / "app.db") as conn:
        import hashlib
        expected_hash = hashlib.sha256(first_key.encode()).hexdigest()
        count = conn.execute(
            "SELECT COUNT(*) FROM api_keys WHERE key_hash = ?", (expected_hash,)
        ).fetchone()[0]
    assert count == 1
