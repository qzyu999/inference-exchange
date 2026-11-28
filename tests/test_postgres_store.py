"""PostgreSQL backend (decision 0008). Skipped unless IE_TEST_DATABASE_URL is set."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pg
import psycopg
import pytest

from inference_exchange.coordinator import pg_schema
from inference_exchange.coordinator.store import SCHEMA, Store

pytestmark = pytest.mark.skipif(not pg.url(), reason="set IE_TEST_DATABASE_URL to run PostgreSQL tests")


def test_store_uses_postgres_when_configured(tmp_path):
    store = Store(db_path=tmp_path / "x.db")
    assert store.backend == "postgres"
    assert store._conn.execute("SELECT current_setting('server_version_num')::int").fetchone()[0] >= 140000


def test_baseline_matches_the_migrated_sqlite_schema(tmp_path):
    """A SQLite database copied to PostgreSQL keeps every column."""
    lite = sqlite3.connect(tmp_path / "lite.db")
    lite.executescript(SCHEMA)
    lite.close()
    migrated = Store.__new__(Store)  # run only the SQLite migrations on that file
    migrated._conn = sqlite3.connect(tmp_path / "lite.db")
    migrated._conn.row_factory = sqlite3.Row
    migrated._migrate()
    sqlite_cols = {t: {r[1] for r in migrated._conn.execute(f"PRAGMA table_info({t})")} for t in pg_schema.TABLES}

    store = Store(db_path=tmp_path / "pg.db")
    pg_cols = {t: {r[0] for r in store._conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
        (t,))} for t in pg_schema.TABLES}
    assert pg_cols == sqlite_cols


def test_migrations_apply_once_and_record_their_version(tmp_path):
    store = Store(db_path=tmp_path / "m.db")
    assert pg_schema.migrate(store._conn) == []
    versions = [r[0] for r in store._conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
    assert versions == [v for v, _, _ in pg_schema.MIGRATIONS]


def test_sum_of_money_is_an_integer(tmp_path):
    store = Store(db_path=tmp_path / "sum.db")
    store.get_or_create_account("buyer")
    store.charge_request("r1", "buyer", "prov", "m", 10, 20, 0.3, 0.7)
    total = store.billing_summary()["total_requests"]
    usage = store.consumer_usage("buyer")
    assert total == 1 and isinstance(usage["cost_micro"], int)


def test_failed_charge_rolls_back_every_write(tmp_path):
    store = Store(db_path=tmp_path / "fail.db")
    store.get_or_create_account("buyer")
    before = dict(store.get_account("buyer"))
    store._conn.execute("""CREATE FUNCTION fail_tx() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.request_id = 'fail-tx' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$""")
    store._conn.execute("CREATE TRIGGER fail_tx BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fail_tx()")
    with pytest.raises(psycopg.Error):
        store.charge_request("fail-tx", "buyer", "new-prov", "m", 5, 7, 0.2, 0.4)
    assert store.get_account("buyer") == before
    assert store.get_account("new-prov") is None
    assert store.charge_request("ok-tx", "buyer", "new-prov", "m", 5, 7, 0.2, 0.4)["cost_micro"] > 0


def test_two_processes_share_one_database_and_serialize_claims(tmp_path):
    """Two Store objects on one database stand in for two coordinator replicas."""
    a = Store(db_path=tmp_path / "shared.db")
    b = Store(db_path=tmp_path / "shared.db")
    user, _ = a.upsert_github_user("gh-1", "octo", "o@example.com", "Octo")
    tokens = [a.create_provider_token(f"p{i}") for i in range(2)]
    principal = b.list_provider_tokens()[0]["billing_account_id"]
    assert len(tokens) == 2

    def claim(store):
        try:
            store.claim_legacy_provider(principal, user["user_id"], user["user_id"], "test")
            return "ok"
        except Exception as exc:  # the loser sees a clean ownership error
            return type(exc).__name__

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = sorted(pool.map(claim, [a, b]))
    assert results == ["ProviderOwnershipError", "ok"]
    assert a._conn.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0] == 1



@pytest.mark.sqlite_only
def test_explicit_path_opens_sqlite_even_with_a_database_url(tmp_path, monkeypatch):
    """The SQLite-only alpha scripts pass db_path; IE_DATABASE_URL must not redirect them."""
    monkeypatch.setenv("IE_DATABASE_URL", pg.url())
    store = Store(db_path=tmp_path / "alpha.db")
    try:
        assert store.backend == "sqlite"
        assert (tmp_path / "alpha.db").is_file()
    finally:
        store.close()
    monkeypatch.delenv("IE_DATABASE_URL")
