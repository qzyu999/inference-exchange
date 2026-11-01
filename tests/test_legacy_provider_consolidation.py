"""Tests for explicit alpha-only legacy provider consolidation (#136).

All database files live under pytest's tmp_path. No live DB is opened.
"""

import argparse
import json
import sqlite3
from pathlib import Path

import pytest

from inference_exchange.coordinator.store import Store
from scripts.consolidate_legacy_provider_accounts import (
    CONFIRMATION,
    ConsolidationError,
    consolidate,
    financial_totals,
    plan,
    run,
)


def make_fixture(tmp_path):
    path = tmp_path / "alpha.db"
    store = Store(db_path=path)
    token = store.create_provider_token("m6-mac-mini")
    canonical = store.validate_provider_token(token)["billing_account_id"]
    store.get_or_create_account("consumer-a", "Consumer")
    for i in range(1, 37):
        store.get_or_create_account(f"provider-{i}", "Historical Mac")
    for i in range(19):
        # Original code used transient WebSocket IDs to bill the same Mac.
        store.charge_request(
            f"old-{i}", "consumer-a", f"provider-{i % 8 + 1}",
            "Qwen2.5 0.5B Instruct", 3, 4, 0.1, 0.15,
            connection_id=f"historical-session-{i}",
        )
    for i in range(29):
        store.charge_request(
            f"stable-{i}", "consumer-a", canonical,
            "Qwen2.5 0.5B Instruct", 3, 4, 0.1, 0.15,
            connection_id=f"stable-session-{i}",
            requested_model="Qwen2.5 0.5B Instruct",
            served_model="Qwen2.5 0.5B Instruct",
        )
    store._conn.close()
    return path, canonical


def arguments(path, canonical, tmp_path, *, apply=False, counts=None, approved=True):
    args = argparse.Namespace(
        db=path,
        backup_dir=tmp_path / "private-backups",
        canonical_principal=canonical,
        apply=apply,
        operator_attests_single_provider=approved,
        confirm=CONFIRMATION if approved else "",
        expected_transactions=None,
        expected_legacy_accounts=None,
        expected_legacy_transactions=None,
    )
    if counts is not None:
        (args.expected_transactions, args.expected_legacy_accounts,
         args.expected_legacy_transactions) = counts
    return args


def db_state(path):
    with sqlite3.connect(path) as conn:
        accounts = {
            row[0]: tuple(row)
            for row in conn.execute("SELECT * FROM accounts")
        }
        transactions = {
            row[0]: tuple(row)
            for row in conn.execute("SELECT * FROM transactions")
        }
        tokens = conn.execute(
            "SELECT token_hash, token_id, billing_account_id, connections FROM provider_tokens"
        ).fetchall()
        history = conn.execute("SELECT * FROM provider_history").fetchall()
    return accounts, transactions, tokens, history


def test_rehearsal_backs_up_wal_and_never_mutates_source(tmp_path):
    path, canonical = make_fixture(tmp_path)
    original = db_state(path)
    result = run(arguments(path, canonical, tmp_path))
    assert result["mode"] == "REHEARSAL_ONLY"
    assert result["accounts_retired"] == 36
    assert result["transactions_remapped"] == 19
    assert result["total_transactions"] == 48
    assert result["legacy_earnings_micro"] == 1710
    assert result["canonical_earnings_micro"] == 4320
    assert (result["marketplace_cost_micro"],
            result["provider_earnings_micro"],
            result["platform_fee_micro"]) == (4800, 4320, 480)
    assert len(result["backup_sha256"]) == 64
    assert Path(result["backup_path"]).exists()
    assert db_state(path) == original
    assert db_state(Path(result["backup_path"])) == original


def test_explicit_apply_remaps_exact_history_and_ignores_starting_grants(tmp_path):
    path, canonical = make_fixture(tmp_path)
    before = db_state(path)
    result = run(arguments(path, canonical, tmp_path, apply=True, counts=(48, 36, 19)))
    assert result["mode"] == "APPLIED"
    after = db_state(path)
    assert len(after[0]) == len(before[0]) - 36
    assert len(after[1]) == 48
    assert after[2] == before[2]  # credential and token hash unchanged
    assert after[3] == before[3]  # history/session audit unchanged
    for row in before[1].values():
        id_ = row[0]
        new = after[1][id_]
        assert new[:3] == row[:3]
        if row[3].startswith("provider-") and not row[3].startswith("provider-acct-"):
            assert new[3] == canonical
        else:
            assert new[3] == row[3]
        assert new[4:] == row[4:]  # amounts, model, consumer, timestamp untouched

    with sqlite3.connect(path) as db:
        account = db.execute(
            "SELECT balance_micro, total_earned_micro FROM accounts WHERE account_id=?",
            (canonical,),
        ).fetchone()
        assert account == (10_004_320, 4320)
        assert db.execute(
            "SELECT COUNT(*) FROM accounts WHERE account_id GLOB 'provider-[0-9]*'"
        ).fetchone()[0] == 0
        assert db.execute(
            "SELECT COUNT(*) FROM provider_legacy_account_archive"
        ).fetchone()[0] == 36
        archive = db.execute(
            "SELECT original_row_json FROM provider_legacy_account_archive"
        ).fetchall()
        assert all(json.loads(row[0])["balance_micro"] >= 10_000_000 for row in archive)
        remaps = db.execute(
            "SELECT original_provider_id, transaction_id FROM provider_legacy_transaction_archive"
        ).fetchall()
        assert len(remaps) == 19
        assert all(r[0].startswith("provider-") for r in remaps)
        assert financial_totals(db) == (48, 4800, 4320, 480)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        consumer = db.execute(
            "SELECT * FROM accounts WHERE account_id='consumer-a'"
        ).fetchone()
        assert tuple(consumer) == before[0]["consumer-a"]
    # The separate retained backup is a valid rollback source.
    assert db_state(Path(result["backup_path"])) == before


def test_repeat_does_not_double_credit_and_fails_closed(tmp_path):
    path, canonical = make_fixture(tmp_path)
    run(arguments(path, canonical, tmp_path, apply=True, counts=(48, 36, 19)))
    snapshot = db_state(path)
    with pytest.raises(ConsolidationError, match="archive already exists"):
        run(arguments(path, canonical, tmp_path))
    assert db_state(path) == snapshot


def test_unexplained_legacy_balance_aborts_without_writes(tmp_path):
    path, canonical = make_fixture(tmp_path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE accounts SET balance_micro=balance_micro+100 WHERE account_id='provider-3'"
        )
    before = db_state(path)
    with pytest.raises(ConsolidationError, match="Unexplained legacy account"):
        run(arguments(path, canonical, tmp_path, apply=True, counts=(48, 36, 19)))
    assert db_state(path) == before


def test_other_provider_credential_blocks_cross_owner_merge(tmp_path):
    path, canonical = make_fixture(tmp_path)
    store = Store(db_path=path)
    store.create_provider_token("another-provider")
    store._conn.close()
    before = db_state(path)
    with pytest.raises(ConsolidationError, match="exactly one active"):
        run(arguments(path, canonical, tmp_path))
    assert db_state(path) == before


def test_explicit_attestation_and_exact_counts_required(tmp_path):
    path, canonical = make_fixture(tmp_path)
    before = db_state(path)
    with pytest.raises(ConsolidationError, match="attestation"):
        run(arguments(path, canonical, tmp_path, apply=True,
                      counts=(48, 36, 19), approved=False))
    with pytest.raises(ConsolidationError, match="Source counts"):
        run(arguments(path, canonical, tmp_path, apply=True,
                      counts=(49, 36, 19)))
    assert db_state(path) == before


def test_live_drift_after_backup_aborts_before_any_migration(tmp_path, monkeypatch):
    from scripts import consolidate_legacy_provider_accounts as module
    path, canonical = make_fixture(tmp_path)
    original_backup = module.backup_source

    def inject_external_billing_change(source, backup_dir):
        backup = original_backup(source, backup_dir)
        # Simulate another coordinator write after the backup, before lock.
        with sqlite3.connect(source) as db:
            db.execute(
                "UPDATE accounts SET name='changed' WHERE account_id='consumer-a'"
            )
        return backup

    monkeypatch.setattr(module, "backup_source", inject_external_billing_change)
    with pytest.raises(ConsolidationError, match="Live database changed"):
        module.run(arguments(path, canonical, tmp_path, apply=True,
                             counts=(48, 36, 19)))
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'provider_legacy_%'"
        ).fetchone()[0] == 0
        assert db.execute(
            "SELECT total_earned_micro FROM accounts WHERE account_id=?",
            (canonical,),
        ).fetchone()[0] == 2610


def test_failed_transaction_rolls_back_all_archive_and_money(tmp_path, monkeypatch):
    path, canonical = make_fixture(tmp_path)
    before = db_state(path)
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        # Fail after transaction remapping but before canonical balance changes.
        conn.execute("""
            CREATE TRIGGER block_canonical_update
            BEFORE UPDATE OF balance_micro ON accounts
            WHEN NEW.account_id = OLD.account_id AND
                 NEW.account_id LIKE 'provider-acct-%'
            BEGIN
                SELECT RAISE(ABORT, 'test injected failure');
            END
        """)
        with pytest.raises(sqlite3.IntegrityError, match="test injected failure"):
            consolidate(conn, canonical)
        assert conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'provider_legacy_%'"
        ).fetchone()[0] == 0
    assert db_state(path) == before


def test_legacy_account_used_as_consumer_is_never_merged(tmp_path):
    path, canonical = make_fixture(tmp_path)
    store = Store(db_path=path)
    store.charge_request(
        "wrong-role", "provider-1", canonical, "mock", 2, 2, 1.0, 1.0,
    )
    store._conn.close()
    before = db_state(path)
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        with pytest.raises(ConsolidationError, match="also used as consumer"):
            plan(conn, canonical)
    assert db_state(path) == before
