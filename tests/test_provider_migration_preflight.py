"""The migration preflight must never mutate the original SQLite file."""

import importlib.util
import sqlite3
from pathlib import Path

import pytest

from inference_exchange.coordinator.store import SCHEMA, Store

# The operator script is not part of the installable IE Python package.
_script = Path(__file__).resolve().parents[1] / "scripts" / "verify_provider_ownership_migration.py"
_spec = importlib.util.spec_from_file_location("ownership_preflight", _script)
_preflight = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_preflight)
PreflightError = _preflight.PreflightError
backup_and_rehearse = _preflight.backup_and_rehearse


def _legacy_schema():
    # PR1's tables/column were absent on the actual pre-ownership alpha DB.
    schema = SCHEMA.replace("    node_id TEXT REFERENCES provider_nodes(node_id),\n", "")
    start = schema.index("CREATE TABLE IF NOT EXISTS provider_nodes (")
    end = schema.index("CREATE TABLE IF NOT EXISTS reference_prices (")
    return schema[:start] + schema[end:]


def _create_source(path: Path, *, legacy: bool = False, empty_principal: bool = False):
    if legacy:
        with sqlite3.connect(path) as con:
            con.executescript(_legacy_schema())
            con.execute(
                "INSERT INTO provider_tokens (token_hash, token_id, name, billing_account_id, created_at) "
                "VALUES ('fake-hash', 'abc', 'provider', ?, 1)",
                ("" if empty_principal else "provider-acct-fixture",),
            )
            con.execute(
                "INSERT INTO accounts (account_id, name, balance_micro, total_earned_micro, created_at) "
                "VALUES ('provider-acct-fixture', 'provider', 10000080, 80, 1)"
            )
            con.execute(
                "INSERT INTO accounts (account_id, name, balance_micro, created_at) "
                "VALUES ('default-consumer', 'Default (anonymous)', 10000000, 1)"
            )
            con.execute(
                "INSERT INTO api_keys (key_hash, key_id, consumer_id, name, created_at) "
                "VALUES ('default-key-placeholder', 'default1', 'default-consumer', 'Default Key', 1)"
            )
            con.execute(
                """INSERT INTO transactions
                   (request_id, consumer_id, provider_id, model, input_tokens, output_tokens,
                    cost_micro, provider_earning_micro, platform_fee_micro, timestamp)
                   VALUES ('old', 'consumer', 'provider-acct-fixture', 'mock', 2, 3, 100, 90, 10, 1)"""
            )
    else:
        s = Store(db_path=path)
        s._conn.close()


def test_preflight_backs_up_and_migrates_only_copy(tmp_path):
    source = tmp_path / "active-alpha.db"
    _create_source(source, legacy=True)
    out = tmp_path / "private-backups"
    data = backup_and_rehearse(source, out)
    assert data["copy_migration"] == "passed"
    assert data["protected_rows_unchanged"]
    assert data["counts"]["provider_tokens"] == 1
    assert data["counts"]["transactions"] == 1
    assert Path(data["backup_path"]).exists()
    assert out.stat().st_mode & 0o077 == 0
    assert Path(data["backup_path"]).stat().st_mode & 0o077 == 0
    # The real DB remains pre-ownership, and the backed-up DB remains pre-ownership.
    with sqlite3.connect(source) as conn:
        assert "node_id" not in [x[1] for x in conn.execute("PRAGMA table_info(provider_tokens)")]
        assert "provider_nodes" not in [x[0] for x in conn.execute("SELECT name FROM sqlite_master")]
    with sqlite3.connect(data["backup_path"]) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1


def test_preflight_preserves_already_migrated_owner_and_tokens(tmp_path):
    source = tmp_path / "current.db"
    s = Store(db_path=source)
    admin, _ = s.upsert_github_user("9990", "admin", "admin@example.com", "Admin")
    owner, _ = s.upsert_github_user("9991", "owner", "owner@example.com", "Owner")
    token = s.create_provider_token("provider")
    principal = s.validate_provider_token(token)["billing_account_id"]
    node = s.claim_legacy_provider(principal, owner["user_id"], admin["user_id"], "preflight")
    s._conn.close()
    data = backup_and_rehearse(source, tmp_path / "backups")
    assert data["counts"]["provider_nodes"] == 1
    assert data["counts"]["provider_ownership_actions"] == 1
    with sqlite3.connect(source) as con:
        assert con.execute(
            "SELECT owner_user_id FROM provider_nodes WHERE node_id = ?", (node["node_id"],)
        ).fetchone()[0] == owner["user_id"]


def test_preflight_refuses_missing_principal_without_live_migration(tmp_path):
    source = tmp_path / "incomplete.db"
    _create_source(source, legacy=True, empty_principal=True)
    with pytest.raises(PreflightError, match="lack stable principals"):
        backup_and_rehearse(source, tmp_path / "backups")
    with sqlite3.connect(source) as con:
        assert con.execute("SELECT billing_account_id FROM provider_tokens").fetchone()[0] == ""


def test_preflight_refuses_insecure_backup_directory(tmp_path):
    source = tmp_path / "db.db"
    _create_source(source)
    backups = tmp_path / "backups"
    backups.mkdir(mode=0o755)
    backups.chmod(0o755)
    with pytest.raises(PreflightError, match="0700"):
        backup_and_rehearse(source, backups)


def test_preflight_refuses_missing_database(tmp_path):
    with pytest.raises(FileNotFoundError):
        backup_and_rehearse(tmp_path / "does-not-exist.db", tmp_path / "backups")
