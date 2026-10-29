"""Read-only live-DB rehearsal uses disposable SQLite files, never user data."""
import sqlite3

import pytest

from inference_exchange.coordinator.store import Store
from scripts.alpha_sqlite_preflight import PreflightError, run_preflight


def _fixture(tmp_path):
    path = tmp_path / "alpha-copy-source.db"
    store = Store(db_path=path)
    owner, _ = store.upsert_github_user("preflight-gh", "preflight", "local@invalid.test", "Fixture")
    raw = store.create_provider_token("old-m6")
    metadata = store.validate_provider_token(raw)
    principal = metadata["billing_account_id"]
    node = store.claim_legacy_provider(principal, owner["user_id"], owner["user_id"], "disposable test")
    store.get_or_create_account("buyer")
    store.charge_request("preflight-r1", "buyer", principal, "test", 15, 25, 0.5, 0.5)
    return path, store, raw, principal, node["node_id"]


def test_read_only_backup_migration_rehearsal_preserves_live_records(tmp_path):
    path, store, raw, principal, node = _fixture(tmp_path)
    with sqlite3.connect(str(path)) as original:
        token_before = original.execute(
            "SELECT token_hash, token_id, billing_account_id, node_id FROM provider_tokens "
            "WHERE billing_account_id = ?", (principal,),
        ).fetchone()
        account_before = original.execute(
            "SELECT * FROM accounts WHERE account_id = ?", (principal,),
        ).fetchone()
        tx_before = original.execute("SELECT * FROM transactions").fetchall()
        keys_before = original.execute("SELECT token_hash FROM provider_tokens ORDER BY token_hash").fetchall()
    result = run_preflight(path, principal, node)
    assert result["ok"] is True
    assert result["source_opened_read_only"] is True
    assert result["migration_executed_on_temporary_copy"] is True
    assert result["protected_tables_unchanged"] == 9
    assert result["existing_provider_ledger_reconciled"] is True
    assert result["historical_transactions"] == 1
    assert "token" not in str(result).lower()
    with sqlite3.connect(str(path)) as original:
        assert original.execute(
            "SELECT token_hash, token_id, billing_account_id, node_id FROM provider_tokens "
            "WHERE billing_account_id = ?", (principal,),
        ).fetchone() == token_before
        assert original.execute(
            "SELECT * FROM accounts WHERE account_id = ?", (principal,),
        ).fetchone() == account_before
        assert original.execute("SELECT * FROM transactions").fetchall() == tx_before
        assert original.execute("SELECT token_hash FROM provider_tokens ORDER BY token_hash").fetchall() == keys_before
    assert store.validate_provider_token(raw) is not None


def test_rejects_missing_or_mismatched_legacy_node(tmp_path):
    path, store, _raw, principal, node = _fixture(tmp_path)
    with pytest.raises(PreflightError):
        run_preflight(path, principal, "node-does-not-exist")
    with pytest.raises(PreflightError):
        run_preflight(path, "provider-acct-absent", node)
    with pytest.raises(PreflightError):
        run_preflight(tmp_path / "missing.db", principal, node)


def test_rejects_nonreconciled_legacy_financial_history(tmp_path):
    path, store, _raw, principal, node = _fixture(tmp_path)
    with store._lock, store._conn:
        store._conn.execute(
            "UPDATE accounts SET total_earned_micro = total_earned_micro + 1 WHERE account_id = ?",
            (principal,),
        )
    with pytest.raises(PreflightError, match="do not reconcile"):
        run_preflight(path, principal, node)
