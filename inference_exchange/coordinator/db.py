"""PostgreSQL connection with the sqlite3 surface that `Store` uses.

`Store` keeps one code path for both backends. This adapter gives a psycopg
connection the parts of the sqlite3 API that `Store` relies on:

- `?` placeholders (translated to `%s`);
- rows that support `row["col"]`, `row[0]`, `tuple(row)` and `dict(row)`;
- `with conn:` as one transaction that commits or rolls back;
- `conn.IntegrityError`.

The connection runs in autocommit mode, so a read never leaves a transaction
open. Every `with conn:` block is an explicit transaction.
"""

from __future__ import annotations

import psycopg
from psycopg import conninfo
from psycopg.types.numeric import NumericLoader


class Row(tuple):
    """A result row addressable by position or column name, like sqlite3.Row."""

    def keys(self):
        return self._keys

    def __getitem__(self, key):
        if isinstance(key, str):
            return tuple.__getitem__(self, self._index[key])
        return tuple.__getitem__(self, key)


def _row_factory(cursor):
    if cursor.description is None:
        return tuple
    keys = tuple(column.name for column in cursor.description)
    index = {name: i for i, name in enumerate(keys)}

    def make(values):
        row = Row(values)
        row._keys, row._index = keys, index
        return row

    return make


class _IntegralNumericLoader(NumericLoader):
    """SUM() of bigint is numeric in PostgreSQL. Money is integer micro-USD, so
    return an int, as SQLite does, instead of a Decimal."""

    def load(self, data):
        value = super().load(data)
        return int(value) if value == value.to_integral_value() else float(value)


def _translate(sql: str) -> str:
    return sql.replace("%", "%%").replace("?", "%s")


def redacted(url: str) -> str:
    """The URL without credentials, safe to log."""
    parts = conninfo.conninfo_to_dict(url)
    return f"postgresql://{parts.get('host', '')}:{parts.get('port', '5432')}/{parts.get('dbname', '')}"


class PgConnection:
    IntegrityError = psycopg.IntegrityError

    def __init__(self, url: str):
        self._raw = psycopg.connect(url, autocommit=True, row_factory=_row_factory)
        self._raw.adapters.register_loader("numeric", _IntegralNumericLoader)
        self._transactions: list = []

    def execute(self, sql: str, params=()):
        if params:
            return self._raw.execute(_translate(sql), params)
        return self._raw.execute(sql)

    def executemany(self, sql: str, rows):
        cursor = self._raw.cursor()
        cursor.executemany(_translate(sql), rows)
        return cursor

    def __enter__(self):
        transaction = self._raw.transaction()
        transaction.__enter__()
        self._transactions.append(transaction)
        return self

    def __exit__(self, exc_type, exc, tb):
        return self._transactions.pop().__exit__(exc_type, exc, tb)

    def commit(self):
        """Statements outside `with conn:` already committed (autocommit)."""

    def rollback(self):
        """Nothing to roll back outside `with conn:`."""

    def close(self):
        self._raw.close()
