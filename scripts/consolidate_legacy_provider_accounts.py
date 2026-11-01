"""One-time, operator-approved alpha provider ledger consolidation (#136).

This is NOT a Store startup migration. By default it backs up a selected SQLite
database and rehearses the consolidation on a temporary copy. Only --apply can
change the explicitly selected source database, and only after a successful
rehearsal, exact snapshot comparison and operator attestation.

Do not use this tool to infer provider ownership from names, machines or IPs.
It is for a one-provider alpha where the operator explicitly attests that every
legacy provider-N billed transaction belongs to the current credential owner.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path
from contextlib import closing
from urllib.parse import quote

OPENING_MICRO = 10_000_000
CONFIRMATION = "CONSOLIDATE-ALPHA-LEGACY-PROVIDER"
PROTECTED_TABLES = (
    "accounts", "transactions", "provider_tokens", "provider_history",
    "provider_nodes", "provider_ownership_actions", "api_keys", "users",
)

ARCHIVE_ACCOUNTS = """CREATE TABLE provider_legacy_account_archive (
    original_account_id TEXT PRIMARY KEY,
    canonical_account_id TEXT NOT NULL,
    original_row_json TEXT NOT NULL,
    migrated_at REAL NOT NULL
)"""
ARCHIVE_TRANSACTIONS = """CREATE TABLE provider_legacy_transaction_archive (
    transaction_id INTEGER PRIMARY KEY,
    original_provider_id TEXT NOT NULL
        REFERENCES provider_legacy_account_archive(original_account_id),
    canonical_account_id TEXT NOT NULL,
    migrated_at REAL NOT NULL
)"""


class ConsolidationError(Exception):
    """An unsafe or ambiguous consolidation was rejected."""


def readonly(path: Path) -> sqlite3.Connection:
    """The production source must only be opened in SQLite's read-only mode."""
    conn = sqlite3.connect(
        "file:" + quote(str(path)) + "?mode=ro", uri=True, timeout=30
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def private_backup_reader(path: Path) -> sqlite3.Connection:
    """Read a PRIVATE backup with SQLite's WAL support available on macOS.

    mode=ro can open a SQLite WAL database but fail on its first PRAGMA when
    SQLite needs to create/open journal sidecars. mode=rw is deliberately
    restricted to a pre-existing operator-owned backup; query_only blocks
    SQL writes. Never use this helper for the production source database.
    """
    if not path.is_file() or path.name != "backup.sqlite":
        raise ConsolidationError("Expected a previously created private backup")
    if not path.parent.name.startswith("provider-consolidation-"):
        raise ConsolidationError("Private backup directory name is unexpected")
    conn = sqlite3.connect(
        "file:" + quote(str(path)) + "?mode=rw", uri=True, timeout=30
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def check_integrity(conn: sqlite3.Connection) -> None:
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ConsolidationError("SQLite integrity check failed")
    if conn.execute("PRAGMA foreign_key_check").fetchall():
        raise ConsolidationError("SQLite foreign key check failed")


def snapshot_digest(conn: sqlite3.Connection) -> str:
    """Compare the backup to the locked live DB without logging secrets."""
    digest = hashlib.sha256()
    for table in PROTECTED_TABLES:
        columns = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
        if not columns:
            raise ConsolidationError("A required table is missing: " + table)
        digest.update(table.encode())
        digest.update(repr(columns).encode())
        for row in conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
            digest.update(repr(tuple(row)).encode())
            digest.update(b"\n")
    return digest.hexdigest()


def financial_totals(conn: sqlite3.Connection) -> tuple[int, int, int, int]:
    return tuple(conn.execute(
        """SELECT COUNT(*), COALESCE(SUM(cost_micro), 0),
                  COALESCE(SUM(provider_earning_micro), 0),
                  COALESCE(SUM(platform_fee_micro), 0)
           FROM transactions"""
    ).fetchone())


def plan(conn: sqlite3.Connection, canonical: str) -> dict:
    """Fail closed on ambiguous credentials or unexplained ledger balances."""
    check_integrity(conn)
    if not re.fullmatch(r"provider-acct-[0-9a-f]+", canonical):
        raise ConsolidationError("Canonical principal must be an exact stable provider-acct ID")
    existing = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    if {"provider_legacy_account_archive",
        "provider_legacy_transaction_archive"} & existing:
        raise ConsolidationError("Migration archive already exists; refusing to apply twice")

    tokens = conn.execute(
        "SELECT billing_account_id, revoked_at FROM provider_tokens"
    ).fetchall()
    if len(tokens) != 1 or tokens[0]["revoked_at"] is not None:
        raise ConsolidationError("Expected exactly one active provider credential")
    if tokens[0]["billing_account_id"] != canonical:
        raise ConsolidationError("Canonical principal does not belong to the active credential")

    principal = conn.execute(
        "SELECT * FROM accounts WHERE account_id = ?", (canonical,)
    ).fetchone()
    if principal is None:
        raise ConsolidationError("Canonical provider ledger account is missing")

    accounts = [dict(r) for r in conn.execute("SELECT * FROM accounts")]
    legacy = {
        a["account_id"]: a for a in accounts
        if re.fullmatch(r"provider-[0-9]+", a["account_id"])
    }
    if not legacy:
        raise ConsolidationError("No legacy accounts to consolidate; refusing repeat")

    # No legacy account may also be an owner, key principal or node principal.
    for table, column in (
        ("api_keys", "consumer_id"),
        ("provider_tokens", "billing_account_id"),
        ("provider_nodes", "billing_account_id"),
    ):
        for row in conn.execute(f'SELECT "{column}" FROM "{table}"'):
            if row[0] in legacy:
                raise ConsolidationError("Legacy account has another identity reference")
    transactions = [dict(r) for r in conn.execute(
        "SELECT * FROM transactions ORDER BY id"
    )]
    if any(r["consumer_id"] in legacy for r in transactions):
        raise ConsolidationError("Legacy provider account was also used as consumer")

    per_account = {a: 0 for a in legacy}
    for row in transactions:
        if row["provider_id"] in per_account:
            per_account[row["provider_id"]] += row["provider_earning_micro"]
        elif (re.fullmatch(r"provider-[0-9]+", row["provider_id"])
              and row["provider_id"] not in legacy):
            raise ConsolidationError("Legacy transaction references a missing account")
        if (row["cost_micro"] < 0 or row["provider_earning_micro"] < 0
                or row["platform_fee_micro"] < 0
                or row["cost_micro"] !=
                row["provider_earning_micro"] + row["platform_fee_micro"]):
            raise ConsolidationError("Existing ledger does not conserve microUSD")

    for account_id, account in legacy.items():
        earned = per_account[account_id]
        if (account["balance_micro"] != OPENING_MICRO + earned
                or account["total_earned_micro"] != earned
                or account["total_spent_micro"] != 0
                or account["requests_made"] != 0
                or account["tokens_consumed"] != 0):
            raise ConsolidationError("Unexplained legacy account balance or usage")

    existing_earned = sum(
        r["provider_earning_micro"] for r in transactions
        if r["provider_id"] == canonical
    )
    if (principal["total_earned_micro"] != existing_earned
            or principal["balance_micro"] != OPENING_MICRO + existing_earned
            or principal["total_spent_micro"] != 0
            or principal["requests_made"] != 0):
        raise ConsolidationError("Canonical account balance has unexplained movements")
    legacy_transactions = [r for r in transactions if r["provider_id"] in legacy]
    if not legacy_transactions:
        raise ConsolidationError("Legacy accounts have no transactions; review separately")
    totals = financial_totals(conn)
    if totals[1] != totals[2] + totals[3]:
        raise ConsolidationError("Overall ledger does not conserve microUSD")
    return {
        "canonical": canonical,
        "legacy_accounts": legacy,
        "legacy_transactions": legacy_transactions,
        "all_transactions": transactions,
        "legacy_earned_micro": sum(per_account.values()),
        "current_earned_micro": existing_earned,
        "totals": totals,
    }


def consolidate(
    conn: sqlite3.Connection, canonical: str, *, already_locked: bool = False,
) -> dict:
    """Recheck assumptions inside a single IMMEDIATE write transaction."""
    if not already_locked:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("BEGIN IMMEDIATE")
    elif not conn.in_transaction:
        raise ConsolidationError("Expected a caller-held IMMEDIATE transaction")
    try:
        before = plan(conn, canonical)
        legacy = before["legacy_accounts"]
        original = {r["id"]: r for r in before["all_transactions"]}
        other_accounts = {
            a["account_id"]: a for a in
            (dict(row) for row in conn.execute("SELECT * FROM accounts"))
            if a["account_id"] not in legacy and a["account_id"] != canonical
        }
        now = time.time()
        conn.execute(ARCHIVE_ACCOUNTS)
        conn.execute(ARCHIVE_TRANSACTIONS)
        conn.executemany(
            """INSERT INTO provider_legacy_account_archive
               (original_account_id, canonical_account_id, original_row_json, migrated_at)
               VALUES (?, ?, ?, ?)""",
            [
                (account_id, canonical, json.dumps(row, sort_keys=True), now)
                for account_id, row in sorted(legacy.items())
            ],
        )
        conn.executemany(
            """INSERT INTO provider_legacy_transaction_archive
               (transaction_id, original_provider_id, canonical_account_id, migrated_at)
               VALUES (?, ?, ?, ?)""",
            [
                (row["id"], row["provider_id"], canonical, now)
                for row in before["legacy_transactions"]
            ],
        )
        ids = [row["id"] for row in before["legacy_transactions"]]
        conn.executemany(
            "UPDATE transactions SET provider_id = ? WHERE id = ? AND provider_id = ?",
            [
                (canonical, row["id"], row["provider_id"])
                for row in before["legacy_transactions"]
            ],
        )
        for row in before["legacy_transactions"]:
            result = conn.execute(
                "SELECT provider_id FROM transactions WHERE id = ?", (row["id"],)
            ).fetchone()
            if result is None or result[0] != canonical:
                raise ConsolidationError("Transaction remapping was incomplete")
        amount = before["legacy_earned_micro"]
        changed = conn.execute(
            """UPDATE accounts
               SET balance_micro = balance_micro + ?,
                   total_earned_micro = total_earned_micro + ?
               WHERE account_id = ?""",
            (amount, amount, canonical),
        )
        if changed.rowcount != 1:
            raise ConsolidationError("Canonical account update failed")
        conn.executemany(
            "DELETE FROM accounts WHERE account_id = ?",
            [(account_id,) for account_id in legacy],
        )
        if any(conn.execute(
            "SELECT 1 FROM accounts WHERE account_id = ?", (account_id,)
        ).fetchone() for account_id in legacy):
            raise ConsolidationError("Legacy account deletion was incomplete")

        actual = {r["id"]: dict(r) for r in conn.execute(
            "SELECT * FROM transactions ORDER BY id"
        )}
        if set(original) != set(actual):
            raise ConsolidationError("Transaction IDs changed")
        for transaction_id, old in original.items():
            new = actual[transaction_id]
            expected_provider = canonical if transaction_id in ids else old["provider_id"]
            if new.pop("provider_id") != expected_provider:
                raise ConsolidationError("Unexpected provider attribution")
            old = dict(old)
            old.pop("provider_id")
            if new != old:
                raise ConsolidationError("Other transaction fields changed")
        if financial_totals(conn) != before["totals"]:
            raise ConsolidationError("Transaction aggregates changed")
        after_accounts = {
            a["account_id"]: a for a in
            (dict(row) for row in conn.execute("SELECT * FROM accounts"))
        }
        if any(after_accounts.get(k) != v for k, v in other_accounts.items()):
            raise ConsolidationError("An unrelated account changed")
        canonical_row = after_accounts[canonical]
        expected_earnings = before["current_earned_micro"] + amount
        if (canonical_row["total_earned_micro"] != expected_earnings
                or canonical_row["balance_micro"] != OPENING_MICRO + expected_earnings):
            raise ConsolidationError("Canonical balance failed reconciliation")
        if conn.execute(
            "SELECT COUNT(*) FROM provider_legacy_account_archive"
        ).fetchone()[0] != len(legacy):
            raise ConsolidationError("Incomplete account archive")
        if conn.execute(
            "SELECT COUNT(*) FROM provider_legacy_transaction_archive"
        ).fetchone()[0] != len(ids):
            raise ConsolidationError("Incomplete transaction archive")
        check_integrity(conn)
        conn.commit()
        return {
            "accounts_retired": len(legacy),
            "transactions_remapped": len(ids),
            "total_transactions": before["totals"][0],
            "legacy_earnings_micro": amount,
            "canonical_earnings_micro": expected_earnings,
            "marketplace_cost_micro": before["totals"][1],
            "provider_earnings_micro": before["totals"][2],
            "platform_fee_micro": before["totals"][3],
        }
    except BaseException:
        conn.rollback()
        raise


def backup_source(source: Path, backup_dir: Path) -> Path:
    """Make a WAL-consistent private backup without writing to the source."""
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if backup_dir.stat().st_mode & 0o077:
        raise ConsolidationError("Backup directory must have mode 0700")

    # macOS rehearsal diagnostics confirmed that SQLite can create an absent
    # destination in a private directory. Do not pre-create an empty SQLite
    # file with mkstemp: it differs from the working online-backup path.
    backup_container = Path(tempfile.mkdtemp(
        prefix="provider-consolidation-", dir=backup_dir
    ))
    destination = backup_container / "backup.sqlite"
    try:
        with closing(readonly(source)) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
                dst.commit()
                # Verify on the same destination handle that the independent
                # macOS diagnostic successfully used.
                check_integrity(dst)
        os.chmod(destination, 0o600)
        # Also verify after a real close/reopen; a WAL-mode snapshot might
        # require writable access to its private journal sidecar files.
        with closing(private_backup_reader(destination)) as db:
            check_integrity(db)
        return destination
    except BaseException:
        shutil.rmtree(backup_container)
        raise


def run(args: argparse.Namespace) -> dict:
    source = args.db.expanduser().resolve(strict=True)
    if not source.is_file():
        raise ConsolidationError("Source is not a SQLite file")
    backup_dir = args.backup_dir.expanduser().resolve()
    if source.parent == backup_dir:
        raise ConsolidationError("Place private backups in a separate directory")
    if args.apply:
        if not args.operator_attests_single_provider or args.confirm != CONFIRMATION:
            raise ConsolidationError("Explicit operator attestation and exact --confirm required")
        if None in (
            args.expected_transactions, args.expected_legacy_accounts,
            args.expected_legacy_transactions,
        ):
            raise ConsolidationError("All three expected counts are required for --apply")

    with readonly(source) as db:
        # Plan and source fingerprint must come from one consistent read snapshot.
        db.execute("BEGIN")
        before = plan(db, args.canonical_principal)
        baseline_digest = snapshot_digest(db)
    observed = (
        before["totals"][0],
        len(before["legacy_accounts"]),
        len(before["legacy_transactions"]),
    )
    expected = (
        args.expected_transactions,
        args.expected_legacy_accounts,
        args.expected_legacy_transactions,
    )
    if args.apply and observed != expected:
        raise ConsolidationError("Source counts changed from operator-approved values")

    backup = backup_source(source, backup_dir)
    with closing(private_backup_reader(backup)) as snap:
        if snapshot_digest(snap) != baseline_digest:
            raise ConsolidationError("Source changed during backup; stop and retry")
    with tempfile.TemporaryDirectory(prefix="provider-rehearsal-", dir=backup_dir) as work:
        rehearsal = Path(work) / "rehearsal.sqlite"
        shutil.copyfile(backup, rehearsal)
        with sqlite3.connect(rehearsal) as db:
            db.row_factory = sqlite3.Row
            result = consolidate(db, args.canonical_principal)

    digest = hashlib.sha256(backup.read_bytes()).hexdigest()
    result["backup_sha256"] = digest
    result["backup_path"] = str(backup)
    result["mode"] = "REHEARSAL_ONLY"
    if not args.apply:
        return result

    with sqlite3.connect(source, timeout=5) as live:
        live.row_factory = sqlite3.Row
        live.execute("PRAGMA foreign_keys=ON")
        live.execute("BEGIN IMMEDIATE")
        try:
            if snapshot_digest(live) != baseline_digest:
                raise ConsolidationError("Live database changed after backup; no writes made")
            # Keep the same write lock through snapshot comparison and commit.
            # Releasing it here would allow a billing write between the checks.
            result = consolidate(live, args.canonical_principal, already_locked=True)
        except BaseException:
            live.rollback()
            raise
    result["backup_sha256"] = digest
    result["backup_path"] = str(backup)
    result["mode"] = "APPLIED"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Verified active SQLite file")
    parser.add_argument("--backup-dir", type=Path, required=True, help="Private 0700 directory")
    parser.add_argument("--canonical-principal", required=True)
    parser.add_argument("--apply", action="store_true", help="Write only after reviewed rehearsal")
    parser.add_argument("--operator-attests-single-provider", action="store_true")
    parser.add_argument("--confirm", default="")
    parser.add_argument("--expected-transactions", type=int)
    parser.add_argument("--expected-legacy-accounts", type=int)
    parser.add_argument("--expected-legacy-transactions", type=int)
    args = parser.parse_args()
    try:
        result = run(args)
    except (ConsolidationError, sqlite3.Error, OSError, ValueError) as exc:
        parser.exit(1, "STOP: " + str(exc) + "\n")
    for key, value in result.items():
        print(f"{key}: {value}")
    print("PROVIDER_CONSOLIDATION_" + result["mode"] + "_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
