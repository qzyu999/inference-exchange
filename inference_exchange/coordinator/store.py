"""SQLite persistence layer — survives restarts.

Stores: accounts, API keys, billing transactions, provider history.
Everything else (live WebSocket connections, in-flight requests) is
inherently ephemeral and stays in-memory.

DB location: ~/.inference-exchange/exchange.db
"""

import hashlib
import logging
import secrets
import sqlite3
import time
from pathlib import Path

from inference_exchange.config import MODELS_DIR

logger = logging.getLogger(__name__)

DB_DIR = Path.home() / ".inference-exchange"
DB_PATH = DB_DIR / "exchange.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    balance_micro INTEGER NOT NULL DEFAULT 10000000,
    total_spent_micro INTEGER NOT NULL DEFAULT 0,
    total_earned_micro INTEGER NOT NULL DEFAULT 0,
    requests_made INTEGER NOT NULL DEFAULT 0,
    tokens_consumed INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    key_hash TEXT PRIMARY KEY,
    key_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used_at REAL,
    requests_made INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (consumer_id) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_micro INTEGER NOT NULL,
    provider_earning_micro INTEGER NOT NULL,
    platform_fee_micro INTEGER NOT NULL,
    timestamp REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    hardware TEXT,
    trust_level TEXT,
    price_output REAL,
    measured_tps REAL,
    connected_at REAL NOT NULL,
    disconnected_at REAL,
    requests_served INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_tokens (
    token_hash TEXT PRIMARY KEY,
    token_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used_at REAL,
    connections INTEGER NOT NULL DEFAULT 0
);
"""

MICRO_PER_DOLLAR = 1_000_000
KEY_PREFIX = "sk-ie-"


class Store:
    """SQLite-backed persistent store for the exchange."""

    PLATFORM_FEE_PERCENT = 10

    def __init__(self, db_path: Path = DB_PATH):
        DB_DIR.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        logger.info(f"Store initialized: {db_path}")

        # Ensure default consumer exists
        self._ensure_account("default-consumer", "Default (anonymous)")

        # Ensure default API key exists, create if not
        self._default_key = self._ensure_default_key()

    def _ensure_account(self, account_id: str, name: str):
        row = self._conn.execute(
            "SELECT account_id FROM accounts WHERE account_id = ?", (account_id,)
        ).fetchone()
        if not row:
            self._conn.execute(
                "INSERT INTO accounts (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)",
                (account_id, name, 10 * MICRO_PER_DOLLAR, time.time()),
            )
            self._conn.commit()

    def _ensure_default_key(self) -> str:
        """Ensure a default key exists, return it."""
        # Check if we have one stored
        row = self._conn.execute(
            "SELECT key_hash FROM api_keys WHERE consumer_id = 'default-consumer' LIMIT 1"
        ).fetchone()
        if row:
            # We can't recover the raw key from the hash, so generate a new one
            # and store it in a special way (or just always regenerate on startup)
            pass

        # Always generate a fresh default key on startup (it's printed to logs)
        raw = KEY_PREFIX + secrets.token_hex(16)
        key_hash = hashlib.sha256(raw.encode()).hexdigest()
        key_id = key_hash[:8]

        # Upsert: delete old default keys, insert new
        self._conn.execute("DELETE FROM api_keys WHERE consumer_id = 'default-consumer'")
        self._conn.execute(
            "INSERT INTO api_keys (key_hash, key_id, consumer_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (key_hash, key_id, "default-consumer", "Default Key", time.time()),
        )
        self._conn.commit()
        logger.info(f"Default API key: {raw[:8]}...")
        return raw

    @property
    def default_key(self) -> str:
        return self._default_key

    # --- Auth ---

    def create_api_key(self, name: str = "API Key") -> tuple[str, str]:
        """Create a new API key. Returns (raw_key, consumer_id)."""
        consumer_id = f"consumer-{secrets.token_hex(4)}"
        raw = KEY_PREFIX + secrets.token_hex(16)
        key_hash = hashlib.sha256(raw.encode()).hexdigest()
        key_id = key_hash[:8]

        # Create account
        self._conn.execute(
            "INSERT INTO accounts (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)",
            (consumer_id, name, 10 * MICRO_PER_DOLLAR, time.time()),
        )
        # Create key
        self._conn.execute(
            "INSERT INTO api_keys (key_hash, key_id, consumer_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (key_hash, key_id, consumer_id, name, time.time()),
        )
        self._conn.commit()
        logger.info(f"API key created: {raw[:12]}... → {consumer_id}")
        return raw, consumer_id

    def validate_key(self, raw_key: str) -> dict | None:
        """Validate key, return metadata or None."""
        if not raw_key or not raw_key.startswith(KEY_PREFIX):
            return None
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        row = self._conn.execute(
            "SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,)
        ).fetchone()
        if row:
            self._conn.execute(
                "UPDATE api_keys SET last_used_at = ?, requests_made = requests_made + 1 WHERE key_hash = ?",
                (time.time(), key_hash),
            )
            self._conn.commit()
            return dict(row)
        return None

    def resolve_consumer(self, authorization: str | None) -> str:
        """Resolve consumer_id from Authorization header."""
        if not authorization:
            return "default-consumer"
        key = authorization[7:] if authorization.lower().startswith("bearer ") else authorization
        result = self.validate_key(key)
        return result["consumer_id"] if result else "default-consumer"

    def list_keys(self) -> list[dict]:
        rows = self._conn.execute("SELECT key_id, name, consumer_id, created_at, last_used_at, requests_made FROM api_keys").fetchall()
        return [dict(r) for r in rows]

    # --- Accounts ---

    def get_account(self, account_id: str) -> dict | None:
        row = self._conn.execute("SELECT * FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
        return dict(row) if row else None

    def get_or_create_account(self, account_id: str, name: str = "Account") -> dict:
        self._ensure_account(account_id, name)
        return self.get_account(account_id)

    def list_accounts(self) -> list[dict]:
        rows = self._conn.execute("SELECT * FROM accounts ORDER BY created_at").fetchall()
        return [dict(r) for r in rows]

    # --- Billing ---

    def charge_request(
        self,
        request_id: str,
        consumer_id: str,
        provider_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        price_per_mtok_input: float,
        price_per_mtok_output: float,
    ) -> dict | None:
        """Charge consumer, credit provider, log transaction."""
        # Calculate cost
        input_cost = int((input_tokens / 1_000_000) * price_per_mtok_input * MICRO_PER_DOLLAR)
        output_cost = int((output_tokens / 1_000_000) * price_per_mtok_output * MICRO_PER_DOLLAR)
        total_cost = max(input_cost + output_cost, 100)  # Minimum $0.0001

        platform_fee = total_cost * self.PLATFORM_FEE_PERCENT // 100
        provider_earning = total_cost - platform_fee

        # Debit consumer
        self._conn.execute(
            "UPDATE accounts SET balance_micro = balance_micro - ?, total_spent_micro = total_spent_micro + ?, requests_made = requests_made + 1, tokens_consumed = tokens_consumed + ? WHERE account_id = ?",
            (total_cost, total_cost, input_tokens + output_tokens, consumer_id),
        )

        # Credit provider (ensure account exists)
        self._ensure_account(provider_id, provider_id)
        self._conn.execute(
            "UPDATE accounts SET balance_micro = balance_micro + ?, total_earned_micro = total_earned_micro + ? WHERE account_id = ?",
            (provider_earning, provider_earning, provider_id),
        )

        # Log transaction
        now = time.time()
        self._conn.execute(
            "INSERT INTO transactions (request_id, consumer_id, provider_id, model, input_tokens, output_tokens, cost_micro, provider_earning_micro, platform_fee_micro, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (request_id, consumer_id, provider_id, model, input_tokens, output_tokens, total_cost, provider_earning, platform_fee, now),
        )
        self._conn.commit()

        logger.info(f"Billed: {output_tokens} tok, cost=${total_cost/MICRO_PER_DOLLAR:.6f}, provider=${provider_earning/MICRO_PER_DOLLAR:.6f}")
        return {
            "request_id": request_id,
            "cost_micro": total_cost,
            "provider_earning_micro": provider_earning,
            "platform_fee_micro": platform_fee,
        }

    def recent_transactions(self, limit: int = 50) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def billing_summary(self) -> dict:
        row = self._conn.execute(
            "SELECT COUNT(*) as total_requests, COALESCE(SUM(cost_micro), 0) as total_volume, COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens FROM transactions"
        ).fetchone()
        return {
            "total_requests": row["total_requests"],
            "total_volume_usd": row["total_volume"] / MICRO_PER_DOLLAR,
            "total_tokens": row["total_tokens"],
            "accounts": self._conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0],
        }

    # --- Provider History ---

    def log_provider_connect(self, provider_id: str, name: str, hardware: str, trust_level: str, price_output: float, measured_tps: float):
        self._conn.execute(
            "INSERT INTO provider_history (provider_id, provider_name, hardware, trust_level, price_output, measured_tps, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (provider_id, name, hardware, trust_level, price_output, measured_tps, time.time()),
        )
        self._conn.commit()

    def log_provider_disconnect(self, provider_id: str):
        self._conn.execute(
            "UPDATE provider_history SET disconnected_at = ? WHERE provider_id = ? AND disconnected_at IS NULL",
            (time.time(), provider_id),
        )
        self._conn.commit()

    # --- Provider tokens ---

    PROVIDER_TOKEN_PREFIX = "pt-ie-"

    def create_provider_token(self, name: str = "Provider") -> str:
        """Create a provider auth token. Returns the raw token (shown once)."""
        raw = self.PROVIDER_TOKEN_PREFIX + secrets.token_hex(16)
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        token_id = token_hash[:8]
        self._conn.execute(
            "INSERT INTO provider_tokens (token_hash, token_id, name, created_at) VALUES (?, ?, ?, ?)",
            (token_hash, token_id, name, time.time()),
        )
        self._conn.commit()
        logger.info(f"Provider token created: {raw[:12]}... ({name})")
        return raw

    def validate_provider_token(self, raw_token: str) -> dict | None:
        """Validate a provider token. Returns metadata or None."""
        if not raw_token or not raw_token.startswith(self.PROVIDER_TOKEN_PREFIX):
            return None
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        row = self._conn.execute(
            "SELECT * FROM provider_tokens WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if row:
            self._conn.execute(
                "UPDATE provider_tokens SET last_used_at = ?, connections = connections + 1 WHERE token_hash = ?",
                (time.time(), token_hash),
            )
            self._conn.commit()
            return dict(row)
        return None

    def list_provider_tokens(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT token_id, name, created_at, last_used_at, connections FROM provider_tokens"
        ).fetchall()
        return [dict(r) for r in rows]
