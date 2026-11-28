"""The one-time SQLite to PostgreSQL copy (decision 0008). Needs IE_TEST_DATABASE_URL."""

import importlib.util
import sqlite3
from pathlib import Path

import pg
import pytest

from inference_exchange.coordinator.store import Store

pytestmark = [
    pytest.mark.skipif(not pg.url(), reason="set IE_TEST_DATABASE_URL to run PostgreSQL tests"),
    pytest.mark.sqlite_only,  # the source is a real SQLite file; the target is chosen below
]

spec = importlib.util.spec_from_file_location(
    "copy_tool", Path(__file__).resolve().parent.parent / "scripts" / "copy_sqlite_to_postgres.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


@pytest.fixture
def target(request):
    schemas = pg.Schemas(pg.url(), request.node.nodeid)
    yield lambda name="target": schemas.for_path(name)
    schemas.drop()


@pytest.fixture
def source(tmp_path, monkeypatch):
    """A SQLite database with users, keys, a provider, charges and history."""
    monkeypatch.setenv("IE_ENV", "dev")
    path = tmp_path / "alpha.db"
    store = Store(db_path=path)
    user = store.create_user("a@example.com", "pw-123456")
    store.create_provider_token("p")
    for i in range(25):
        store.charge_request(f"r{i}", user["user_id"], "provider-x", "m", 100 + i, 50 + i, 0.3, 0.7)
    store.log_provider_connect("provider-1", "p", "apple-m4", "open", 0.7, 30.0, session_id="s1")
    store.suspend_user(user["user_id"], "test", "admin", 60)
    store.save_request_outcome({"request_id": "rq", "status": "completed"}, user["user_id"])
    store._conn.close()
    return path


def _count(url, table):
    from inference_exchange.coordinator.db import PgConnection
    conn = PgConnection(url)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def test_rehearsal_checks_everything_and_commits_nothing(source, target):
    url = target()
    report = tool.copy(source, url, apply=False)
    assert report["tables"]["transactions"] == 25 and not report["applied"]
    assert _count(url, "transactions") == 0


def test_apply_copies_rows_and_money_exactly(source, target):
    url = target()
    report = tool.copy(source, url, apply=True)
    lite = sqlite3.connect(source)
    for table, count in report["tables"].items():
        assert lite.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == count == _count(url, table)
    expected = lite.execute("SELECT SUM(balance_micro), SUM(total_spent_micro), SUM(total_earned_micro) FROM accounts").fetchone()
    assert tuple(report["money_micro"].values()) == expected


def test_copied_database_serves_as_the_store(source, target, monkeypatch):
    """The copy is usable: balances are intact and new IDs do not collide."""
    url = target()
    tool.copy(source, url, apply=True)
    lite = sqlite3.connect(source)
    user_id = lite.execute("SELECT user_id FROM users").fetchone()[0]
    balance = lite.execute("SELECT balance_micro FROM accounts WHERE account_id = ?", (user_id,)).fetchone()[0]
    max_id = lite.execute("SELECT MAX(id) FROM transactions").fetchone()[0]

    monkeypatch.setenv("IE_DATABASE_URL", url)
    store = Store()
    try:
        assert store.backend == "postgres"
        assert store.get_account(user_id)["balance_micro"] == balance
        store.charge_request("after-copy", user_id, "provider-x", "m", 10, 10, 0.3, 0.7)
        new_id = store._conn.execute("SELECT id FROM transactions WHERE request_id = 'after-copy'").fetchone()[0]
        assert new_id == max_id + 1
    finally:
        store.close()


def test_refuses_a_target_that_already_has_rows(source, target):
    url = target()
    tool.copy(source, url, apply=True)
    with pytest.raises(tool.CopyError, match="not empty"):
        tool.copy(source, url, apply=True)


def test_refuses_a_source_that_fails_integrity(tmp_path, target):
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"SQLite format 3\x00" + b"\xff" * 4096)
    url = target()
    with pytest.raises((tool.CopyError, sqlite3.DatabaseError)):
        tool.copy(bad, url, apply=True)
    # The source is checked before the target is touched: no tables were created.
    from inference_exchange.coordinator.db import PgConnection
    conn = PgConnection(url)
    try:
        assert conn.execute("SELECT to_regclass('accounts')").fetchone()[0] is None
    finally:
        conn.close()


def test_a_failed_check_rolls_back_the_whole_copy(source, target, monkeypatch):
    url = target()

    def corrupt(lite, pg_conn, report):
        raise tool.CopyError("injected check failure")

    monkeypatch.setattr(tool, "_verify", corrupt)
    with pytest.raises(tool.CopyError, match="injected"):
        tool.copy(source, url, apply=True)
    assert _count(url, "transactions") == 0 and _count(url, "accounts") == 0
