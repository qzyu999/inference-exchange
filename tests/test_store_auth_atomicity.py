"""#84: shared SQLite account/auth write transaction regressions (temp DB only)."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from inference_exchange.coordinator.store import Store


def _abort_on_account_insert(store, account_id: str):
    store._conn.execute(
        """CREATE TRIGGER block_account BEFORE INSERT ON accounts
           WHEN NEW.account_id = 'REPLACE_ID'
           BEGIN SELECT RAISE(ABORT, 'simulated second-statement failure'); END""".replace("REPLACE_ID", account_id)
    )
    store._conn.commit()


def test_failed_password_registration_creates_no_orphan_identity(tmp_path, monkeypatch):
    store = Store(db_path=tmp_path / "user-txn.db")
    # Deterministic target user ID: patch secrets only for this disposable DB.
    monkeypatch.setattr("inference_exchange.coordinator.store.secrets.token_hex",
                        lambda n: "abc12345" if n == 4 else "a" * (n * 2))
    _abort_on_account_insert(store, "user-abc12345")
    with pytest.raises(sqlite3.IntegrityError):
        store.create_user("user@example.com", "test-password")
    assert store._conn.execute("SELECT COUNT(*) FROM users WHERE email='user@example.com'").fetchone()[0] == 0
    assert store._conn.execute("SELECT COUNT(*) FROM api_keys WHERE consumer_id='user-abc12345'").fetchone()[0] == 0


def test_failed_github_registration_creates_no_orphan_identity(tmp_path, monkeypatch):
    store = Store(db_path=tmp_path / "github-txn.db")
    monkeypatch.setattr("inference_exchange.coordinator.store.secrets.token_hex",
                        lambda n: "def98765" if n == 4 else "b" * (n * 2))
    _abort_on_account_insert(store, "user-def98765")
    with pytest.raises(sqlite3.IntegrityError):
        store.upsert_github_user("octo-id-98765", "octo", "octo@example.com", "Octo")
    assert store._conn.execute("SELECT COUNT(*) FROM users WHERE github_id='octo-id-98765'").fetchone()[0] == 0
    assert store._conn.execute("SELECT COUNT(*) FROM accounts WHERE account_id='user-def98765'").fetchone()[0] == 0


def test_failed_suspension_rollback_includes_session_version(tmp_path):
    store = Store(db_path=tmp_path / "suspension-txn.db")
    user, _ = store.upsert_github_user("octo-id-susp", "susp", "susp@example.com", "Susp")
    user_id = user["user_id"]
    before = store.get_session_version(user_id)
    store._conn.execute(
        """CREATE TRIGGER block_action BEFORE INSERT ON account_actions
           BEGIN SELECT RAISE(ABORT, 'audit write failed'); END"""
    )
    store._conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        store.suspend_user(user_id, "abuse", "operator", None)
    assert store.get_session_version(user_id) == before
    assert store.get_suspension(user_id) is None
    assert store._conn.execute("SELECT COUNT(*) FROM account_actions").fetchone()[0] == 0


def test_parallel_github_upsert_and_key_validation_are_serialized(tmp_path):
    store = Store(db_path=tmp_path / "github-parallel.db")
    owner, _ = store.upsert_github_user("github-shared", "shared", "shared@example.com", "Shared")
    key = store.create_api_key_for_user(owner["user_id"])
    def worker(i):
        if i % 2:
            u, created = store.upsert_github_user("github-shared", "shared", "shared@example.com", "Shared")
            assert u["user_id"] == owner["user_id"] and not created
        else:
            assert store.validate_key(key)["consumer_id"] == owner["user_id"]
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(worker, range(100)))
    assert store._conn.execute("SELECT COUNT(*) FROM users WHERE github_id='github-shared'").fetchone()[0] == 1
    assert store._conn.execute("SELECT requests_made FROM api_keys WHERE consumer_id=?",
                               (owner["user_id"],)).fetchone()[0] == 50
