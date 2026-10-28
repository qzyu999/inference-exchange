"""Safely back up an explicitly selected IE SQLite DB and rehearse migrations.

The source SQLite connection is read-only. Store() opens ONLY the rehearsal
copy. Retain the backup as an operator-controlled, sensitive local file.

Usage:
    python scripts/verify_provider_ownership_migration.py \
        --db /path/to/verified-active.db --backup-dir /private/backup/directory

Verify the PID's open DB with lsof before selecting --db. Never rely on the
default path without checking the running coordinator.
"""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

PROTECTED_TABLES = (
    "accounts",
    "api_keys",
    "transactions",
    "provider_tokens",
    "provider_history",
    "users",
    "provider_nodes",
    "provider_ownership_actions",
)


class PreflightError(Exception):
    """Preflight failed. The live source has not been opened for writing."""


def _readonly_connection(path: Path) -> sqlite3.Connection:
    # Use SQLite's read-only URI. Do not let a mistyped path create a new DB.
    conn = sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True, timeout=30)
    conn.execute("PRAGMA query_only=ON")
    return conn


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {
        row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    # Table names come from our hard-coded allowlist; PRAGMA returns the columns.
    return [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]


def _fingerprints(conn: sqlite3.Connection) -> tuple[dict, dict, dict]:
    """Hash original rows without writing, displaying, or returning secrets."""
    present = _tables(conn)
    rows = {}
    hashes = {}
    col_map = {}
    for table in PROTECTED_TABLES:
        if table not in present:
            continue
        columns = _columns(conn, table)
        col_map[table] = columns
        select = ", ".join('"' + col.replace('"', '""') + '"' for col in columns)
        digest = hashlib.sha256()
        n = 0
        # Existing Store rotates only the anonymous default API key at
        # startup. Other consumer keys must remain byte-for-byte identical.
        where = " WHERE consumer_id != 'default-consumer'" if table == "api_keys" else ""
        for row in conn.execute(f'SELECT {select} FROM "{table}"{where} ORDER BY rowid'):
            # JSON is an unambiguous representation for IE's text/numeric columns.
            digest.update(json.dumps(row, separators=(",", ":"), ensure_ascii=True).encode())
            digest.update(b"\\n")
            n += 1
        hashes[table] = digest.hexdigest()
        rows[table] = n
    return hashes, rows, col_map


def _check_integrity(conn: sqlite3.Connection) -> None:
    result = conn.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise PreflightError("SQLite integrity check failed")
    bad_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
    if bad_keys:
        raise PreflightError("SQLite foreign key check failed")


def _check_identity_prerequisites(conn: sqlite3.Connection) -> None:
    """Expect a post-#136 source: existing tokens have their own principals."""
    tables = _tables(conn)
    if not {"provider_tokens", "accounts", "transactions", "users"}.issubset(tables):
        raise PreflightError("Source does not contain the IE billing and identity tables")
    if "billing_account_id" not in _columns(conn, "provider_tokens"):
        raise PreflightError("Provider principal column missing; investigate before deployment")
    missing = conn.execute(
        "SELECT COUNT(*) FROM provider_tokens "
        "WHERE billing_account_id IS NULL OR billing_account_id = ''"
    ).fetchone()[0]
    if missing:
        raise PreflightError("Existing provider credentials lack stable principals")


def backup_and_rehearse(db_path: Path, backup_dir: Path) -> dict:
    """Read live DB once, retain private backup, mutate only a temporary copy."""
    source = db_path.expanduser().resolve(strict=True)
    if not source.is_file():
        raise PreflightError("Source DB is not a regular file")
    backup_dir = backup_dir.expanduser().resolve()
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not backup_dir.is_dir() or backup_dir.stat().st_mode & 0o077:
        raise PreflightError("Backup directory must be accessible only by its owner (mode 0700)")
    if backup_dir == source.parent and source.name.startswith("ownership-backup-"):
        raise PreflightError("Do not use a previous backup as the live source")

    created = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # mkstemp is atomic, unique, and defaults to mode 0600.
    fd, path = tempfile.mkstemp(prefix=f"ownership-backup-{created}-", suffix=".db", dir=backup_dir)
    os.close(fd)
    backup = Path(path)
    try:
        with _readonly_connection(source) as src:
            with sqlite3.connect(backup) as dst:
                src.backup(dst)
                dst.commit()
        with sqlite3.connect(backup) as snap:
            _check_integrity(snap)
            _check_identity_prerequisites(snap)
            fingerprints, counts, original_columns = _fingerprints(snap)
        with tempfile.TemporaryDirectory(prefix="ownership-rehearsal-", dir=backup_dir) as td:
            rehearsal = Path(td) / "rehearsal.db"
            shutil.copyfile(backup, rehearsal)
            from inference_exchange.coordinator.store import Store
            store = Store(db_path=rehearsal)
            store._conn.close()
            with sqlite3.connect(rehearsal) as migrated:
                _check_integrity(migrated)
                if "node_id" not in _columns(migrated, "provider_tokens"):
                    raise PreflightError("Migration did not add the provider node reference")
                if not {"provider_nodes", "provider_ownership_actions"}.issubset(_tables(migrated)):
                    raise PreflightError("Migration did not create the ownership tables")
                after_hashes = {}
                for table, columns in original_columns.items():
                    select = ", ".join('"' + col.replace('"', '""') + '"' for col in columns)
                    digest = hashlib.sha256()
                    where = " WHERE consumer_id != 'default-consumer'" if table == "api_keys" else ""
                    for row in migrated.execute(
                        f'SELECT {select} FROM "{table}"{where} ORDER BY rowid'
                    ):
                        digest.update(json.dumps(row, separators=(",", ":"), ensure_ascii=True).encode())
                        digest.update(b"\\n")
                    after_hashes[table] = digest.hexdigest()
                if fingerprints != after_hashes:
                    changed = [name for name in fingerprints if fingerprints[name] != after_hashes.get(name)]
                    raise PreflightError("Copy migration changed protected rows: " + ", ".join(changed))
                if "provider_nodes" not in original_columns:
                    if migrated.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0]:
                        raise PreflightError("Migration incorrectly assigned legacy provider ownership")
                if "provider_ownership_actions" not in original_columns:
                    if migrated.execute("SELECT COUNT(*) FROM provider_ownership_actions").fetchone()[0]:
                        raise PreflightError("Migration incorrectly created ownership events")

        return {
            "backup_path": str(backup),
            "integrity": "ok",
            "copy_migration": "passed",
            "protected_rows_unchanged": True,
            "counts": counts,
        }
    except Exception:
        # Keep the snapshot after a rehearsal failure for local investigation.
        # If backup itself failed, do not retain a half-written backup file.
        if not backup.exists() or backup.stat().st_size == 0:
            backup.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="PID-verified live SQLite DB")
    parser.add_argument("--backup-dir", type=Path, required=True, help="Private, mode 0700 directory")
    args = parser.parse_args()
    try:
        result = backup_and_rehearse(args.db, args.backup_dir)
    except (PreflightError, OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"STOP: {error}\n")
    print("Verified SQLite online backup and isolated ownership migration.")
    print("Backup (sensitive; keep private): " + result["backup_path"])
    print("Integrity: ok | Copy migration: passed | Protected data: unchanged")
    print("Row counts (no key material): " + json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
