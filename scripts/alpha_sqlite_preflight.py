"""Read-only preflight for an existing alpha SQLite ledger and provider identity.

The source database is opened with mode=ro. SQLite's backup API creates an
isolated snapshot. Schema migration and Store startup are run ONLY on that
temporary copy. Never pass a raw provider credential to this script.

Usage:
  python scripts/alpha_sqlite_preflight.py --db "$IE_DB_PATH" \
    --principal "$IE_LEGACY_PROVIDER_PRINCIPAL" \
    --node-id "$IE_LEGACY_NODE_ID"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
from pathlib import Path

from inference_exchange.coordinator.store import Store


class PreflightError(RuntimeError):
    """A migration/ledger safety check failed. No source DB writes attempted."""


# The Store rotates its anonymous development key on startup. api_keys are
# intentionally excluded; protect stable user/provider identity and ledgers.
PROTECTED_TABLES = (
    "accounts", "transactions", "provider_tokens", "provider_nodes",
    "provider_ownership_actions", "provider_history", "users",
    "account_actions", "reference_prices",
)


def _integrity(conn: sqlite3.Connection) -> None:
    result = conn.execute("PRAGMA integrity_check").fetchone()
    if result is None or result[0] != "ok":
        raise PreflightError("Snapshot failed SQLite integrity_check")
    broken = conn.execute("PRAGMA foreign_key_check").fetchone()
    if broken is not None:
        raise PreflightError("Snapshot contains foreign-key violations")


def _table_fingerprint(conn: sqlite3.Connection, table: str, columns: tuple[str, ...] | None = None):
    """Return schema columns, row count and private digest, never stored in a report."""
    if table not in PROTECTED_TABLES:
        raise ValueError("Unexpected table")
    present = tuple(row[1] for row in conn.execute(f"PRAGMA table_info({table})"))
    if not present:
        raise PreflightError(f"Required table missing: {table}")
    cols = columns or present
    if any(col not in present for col in cols):
        raise PreflightError(f"Required historical column removed: {table}")
    quoted = ", ".join('"' + c.replace('"', '""') + '"' for c in cols)
    digest = hashlib.sha256()
    count = 0
    # Order is irrelevant to the checksum: each row has a newline delimiter
    # and we sort by the table's stable primary identifier rather than rowid.
    key = {
        "accounts": "account_id",
        "transactions": "id",
        "provider_tokens": "token_hash",
        "provider_nodes": "node_id",
        "provider_ownership_actions": "id",
        "provider_history": "id",
        "users": "user_id",
        "account_actions": "id",
        "reference_prices": "id",
    }[table]
    for row in conn.execute(f"SELECT {quoted} FROM {table} ORDER BY {key}"):
        digest.update(json.dumps(list(row), ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
        count += 1
    return cols, count, digest.digest()


def _protected_snapshot(conn: sqlite3.Connection):
    return {table: _table_fingerprint(conn, table) for table in PROTECTED_TABLES}


def _assert_existing_provider(conn: sqlite3.Connection, principal: str, node_id: str) -> str:
    if not principal.startswith("provider-acct-") or not node_id.startswith("node-"):
        raise PreflightError("Expected an existing provider principal and node ID")
    tokens = conn.execute(
        """SELECT token_id, node_id, revoked_at FROM provider_tokens
           WHERE billing_account_id = ?""",
        (principal,),
    ).fetchall()
    if len(tokens) != 1 or tokens[0][1] != node_id or tokens[0][2] is not None:
        raise PreflightError("Existing provider credential is missing, revoked or mismatched")
    owner = conn.execute(
        """SELECT owner_user_id FROM provider_nodes
           WHERE billing_account_id = ? AND node_id = ?""",
        (principal, node_id),
    ).fetchone()
    if owner is None or not owner[0]:
        raise PreflightError("Existing provider node or owner binding is missing")
    account = conn.execute("SELECT 1 FROM accounts WHERE account_id = ?", (principal,)).fetchone()
    if account is None:
        raise PreflightError("Existing provider billing account is missing")
    return str(owner[0])


def run_preflight(db_path: Path, principal: str, node_id: str) -> dict:
    """Create a temporary snapshot, migrate it, compare existing rows, then delete it.

    The source is never opened for writes and never passed to Store().
    """
    db_path = Path(db_path).expanduser().resolve()
    if not db_path.is_file():
        raise PreflightError("Source SQLite file does not exist")
    with tempfile.TemporaryDirectory(prefix="ie-alpha-db-preflight-") as temp:
        copy_path = Path(temp) / "snapshot.db"
        uri = db_path.as_uri() + "?mode=ro"
        try:
            with sqlite3.connect(uri, uri=True, timeout=30.0) as original:
                original.execute("PRAGMA busy_timeout=5000")
                with sqlite3.connect(str(copy_path)) as clone:
                    original.backup(clone)
            # Source is now closed. All remaining work is on the disposable copy.
            with sqlite3.connect(str(copy_path)) as snapshot:
                _integrity(snapshot)
                owner_id = _assert_existing_provider(snapshot, principal, node_id)
                before = _protected_snapshot(snapshot)

            migrated = Store(db_path=copy_path)
            try:
                with sqlite3.connect(str(copy_path)) as checked:
                    _integrity(checked)
                    _assert_existing_provider(checked, principal, node_id)
                    after = {
                        table: _table_fingerprint(checked, table, previous[0])
                        for table, previous in before.items()
                    }
                    for table in PROTECTED_TABLES:
                        if before[table] != after[table]:
                            raise PreflightError(f"Migration changed protected historical data: {table}")
                earnings = migrated.get_owned_provider_earnings(owner_id, node_id=node_id)
                if earnings is None or not earnings["summary"]["reconciled"]:
                    raise PreflightError("Existing provider earnings do not reconcile")
                return {
                    "ok": True,
                    "source_opened_read_only": True,
                    "migration_executed_on_temporary_copy": True,
                    "protected_tables_unchanged": len(PROTECTED_TABLES),
                    "historical_transactions": before["transactions"][1],
                    "existing_provider_ledger_reconciled": True,
                    "simulated_credits_only": True,
                }
            finally:
                migrated._conn.close()
        except sqlite3.Error as exc:
            raise PreflightError(f"SQLite backup or preflight failed: {type(exc).__name__}") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path, help="existing coordinator SQLite file (read only)")
    parser.add_argument("--principal", required=True, help="existing stable provider billing principal (not credential)")
    parser.add_argument("--node-id", required=True, help="existing provider node ID (not credential)")
    args = parser.parse_args()
    try:
        result = run_preflight(args.db, args.principal, args.node_id)
    except PreflightError as exc:
        parser.exit(1, "FAILED: " + str(exc) + "\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
