"""Copy the coordinator's SQLite database into an empty PostgreSQL database.

One-time move for decision 0008. Run it with the coordinator stopped.

    python scripts/copy_sqlite_to_postgres.py --sqlite PATH --database-url URL [--apply]

Without --apply the tool rehearses: it copies inside one transaction, runs
every check, then rolls back. With --apply it commits only if every check
passes. The source file opens read-only.

Checks, all on the target before commit, against the source:
- the source passes `PRAGMA integrity_check`;
- the target has no rows in any coordinator table;
- every table has the same row count;
- every row matches column by column (SHA-256 over each table, in key order);
- money totals match per account: balance, spent and earned;
- every transaction satisfies cost = provider earning + platform fee;
- identity sequences continue after the largest copied ID.
"""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from inference_exchange.coordinator import pg_schema  # noqa: E402
from inference_exchange.coordinator.db import PgConnection, redacted  # noqa: E402

IDENTITY_TABLES = ("transactions", "provider_history", "provider_ownership_actions",
                   "reference_prices", "account_actions")
MONEY = ("balance_micro", "total_spent_micro", "total_earned_micro")


class CopyError(Exception):
    """A check failed. Nothing was committed."""


def _columns(pg, table: str) -> list[str]:
    return [r[0] for r in pg.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position", (table,))]


def _key(pg, table: str) -> list[str]:
    return [r[0] for r in pg.execute(
        """SELECT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = (current_schema() || '.' || ?)::regclass AND i.indisprimary
           ORDER BY a.attname""", (table,))]


def _digest(rows) -> str:
    h = hashlib.sha256()
    for row in rows:
        h.update(repr(tuple(row)).encode())
    return h.hexdigest()


def copy(source: Path, url: str, *, apply: bool) -> dict:
    if not source.is_file():
        raise CopyError(f"Source SQLite file does not exist: {source}")
    lite = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if lite.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CopyError("Source SQLite file fails integrity_check")
        pg = PgConnection(url)
        try:
            pg_schema.migrate(pg)
            report = _copy_in_transaction(lite, pg, apply=apply)
        finally:
            pg.close()
    finally:
        lite.close()
    report["target"] = redacted(url)
    report["applied"] = apply
    return report


def _copy_in_transaction(lite, pg, *, apply: bool) -> dict:
    report = {"tables": {}}
    pg._raw.autocommit = False
    try:
        for table in pg_schema.TABLES:
            if pg.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise CopyError(f"Target table {table} is not empty")
        for table in pg_schema.TABLES:
            cols = _columns(pg, table)
            source_cols = {r[1] for r in lite.execute(f"PRAGMA table_info({table})")}
            missing = set(cols) - source_cols
            if missing:
                raise CopyError(f"Source table {table} lacks columns {sorted(missing)}; "
                                "start the current coordinator on it once to migrate it")
            listed = ", ".join(cols)
            rows = lite.execute(f"SELECT {listed} FROM {table}").fetchall()
            if rows:
                marks = ", ".join("?" for _ in cols)
                overriding = " OVERRIDING SYSTEM VALUE" if table in IDENTITY_TABLES else ""
                pg.executemany(f"INSERT INTO {table} ({listed}){overriding} VALUES ({marks})", rows)
            report["tables"][table] = len(rows)
        for table in IDENTITY_TABLES:
            pg.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
            )
        _verify(lite, pg, report)
    except Exception:
        pg._raw.rollback()
        raise
    if apply:
        pg._raw.commit()
    else:
        pg._raw.rollback()
    return report


def _verify(lite, pg, report: dict) -> None:
    for table, count in report["tables"].items():
        target = pg.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if target != count:
            raise CopyError(f"{table}: {count} source rows, {target} target rows")
        cols = _columns(pg, table)
        order = ", ".join(_key(pg, table))
        listed = ", ".join(cols)
        a = _digest(lite.execute(f"SELECT {listed} FROM {table} ORDER BY {order}"))
        b = _digest(pg.execute(f"SELECT {listed} FROM {table} ORDER BY {order}"))
        if a != b:
            raise CopyError(f"{table}: row contents differ after the copy")

    money = ", ".join(MONEY)
    source = {r[0]: tuple(r[1:]) for r in lite.execute(f"SELECT account_id, {money} FROM accounts")}
    target = {r[0]: tuple(r[1:]) for r in pg.execute(f"SELECT account_id, {money} FROM accounts")}
    if source != target:
        diff = sorted(k for k in source.keys() | target.keys() if source.get(k) != target.get(k))
        raise CopyError(f"Account money differs for {len(diff)} account(s), first: {diff[0]}")
    split = pg.execute(
        "SELECT COUNT(*) FROM transactions WHERE cost_micro <> provider_earning_micro + platform_fee_micro"
    ).fetchone()[0]
    if split:
        raise CopyError(f"{split} transaction(s) do not satisfy cost = earning + fee")
    totals = pg.execute(f"SELECT {', '.join(f'COALESCE(SUM({c}), 0)' for c in MONEY)} FROM accounts").fetchone()
    report["money_micro"] = dict(zip(MONEY, totals))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sqlite", required=True, type=Path)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--apply", action="store_true", help="commit; without it the copy is rolled back")
    args = parser.parse_args(argv)
    try:
        report = copy(args.sqlite, args.database_url, apply=args.apply)
    except CopyError as exc:
        print(f"FAILED, nothing committed: {exc}")
        return 1
    print(f"{'COMMITTED' if report['applied'] else 'REHEARSAL OK, rolled back'} -> {report['target']}")
    for table, count in report["tables"].items():
        print(f"  {table:30} {count:>9} rows")
    for name, value in report["money_micro"].items():
        print(f"  {name:30} {value:>15} micro-USD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
