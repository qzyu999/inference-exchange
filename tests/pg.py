"""PostgreSQL test isolation: one schema per test database path.

Set IE_TEST_DATABASE_URL to run the suite on PostgreSQL. Each distinct
`db_path` a test uses gets its own schema, so tests that open two stores on
two paths get two databases, and two stores on one path share one, exactly
as with SQLite files. Schemas are dropped when the test ends.
"""

from __future__ import annotations

import hashlib
import os

import psycopg
from psycopg import conninfo

ENV = "IE_TEST_DATABASE_URL"


def url() -> str:
    return os.environ.get(ENV, "").strip()


def schema_url(base: str, schema: str) -> str:
    parts = conninfo.conninfo_to_dict(base)
    parts["options"] = f"-c search_path={schema}"
    return conninfo.make_conninfo(**parts)


class Schemas:
    """Maps a test's database paths to schemas on one server."""

    def __init__(self, base: str, test_id: str):
        self.base = base
        self.prefix = "t_" + hashlib.sha1(test_id.encode()).hexdigest()[:12]
        self.made: dict[str, str] = {}

    def for_path(self, path) -> str:
        key = str(path)
        if key not in self.made:
            schema = f"{self.prefix}_{len(self.made)}"
            with psycopg.connect(self.base, autocommit=True) as conn:
                conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
                conn.execute(f'CREATE SCHEMA "{schema}"')
            self.made[key] = schema
        return schema_url(self.base, self.made[key])

    def drop(self):
        if not self.made:
            return
        with psycopg.connect(self.base, autocommit=True) as conn:
            for schema in self.made.values():
                conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


def fail_inserts(store, table: str, when_sql: str = "TRUE", name: str = "fail_insert") -> type[Exception]:
    """Make INSERTs into `table` fail when `when_sql` holds for NEW. Returns the error type.

    One helper for both backends, so a rollback test checks the Store, not a dialect.
    """
    if getattr(store, "backend", "sqlite") == "postgres":
        store._conn.execute(
            f"CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$ "
            f"BEGIN IF {when_sql} THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$"
        )
        store._conn.execute(f"CREATE TRIGGER {name} BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION {name}()")
        return psycopg.Error
    import sqlite3
    store._conn.execute(
        f"CREATE TRIGGER {name} BEFORE INSERT ON {table} WHEN {when_sql.replace('TRUE', '1')} "
        f"BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
    )
    store._conn.commit()
    return sqlite3.IntegrityError


def rows(store, table: str) -> list[tuple]:
    """All rows of a table in a stable order, through the Store's own connection."""
    order = "rowid" if getattr(store, "backend", "sqlite") == "sqlite" else "1"
    return [tuple(r) for r in store._conn.execute(f"SELECT * FROM {table} ORDER BY {order}")]


def index_columns(store, index: str) -> list[str]:
    """Column names of an index, in order."""
    if getattr(store, "backend", "sqlite") == "sqlite":
        return [r[2] for r in store._conn.execute(f"PRAGMA index_info({index})")]
    return [r[0] for r in store._conn.execute(
        """SELECT a.attname FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
           WHERE c.relname = ? AND c.relnamespace = current_schema()::regnamespace
           ORDER BY k.ord""", (index,))]
