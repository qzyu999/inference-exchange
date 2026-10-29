"""SQLite persistence layer — survives restarts.

Stores: accounts, API keys, billing transactions, provider history.
Everything else (live WebSocket connections, in-flight requests) is
inherently ephemeral and stays in-memory.

DB location: ~/.inference-exchange/exchange.db
"""

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from inference_exchange.config import MODELS_DIR

logger = logging.getLogger(__name__)

DB_DIR = Path.home() / ".inference-exchange"
DB_PATH = DB_DIR / "exchange.db"
DEFAULT_CONSUMER_ID = "default-consumer"

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
    connection_id TEXT NOT NULL DEFAULT '',
    provider_name TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micro INTEGER NOT NULL,
    cost_input_micro INTEGER NOT NULL DEFAULT 0,
    cost_output_micro INTEGER NOT NULL DEFAULT 0,
    cost_cache_micro INTEGER NOT NULL DEFAULT 0,
    provider_earning_micro INTEGER NOT NULL,
    platform_fee_micro INTEGER NOT NULL,
    trust_level TEXT NOT NULL DEFAULT '',
    encrypted INTEGER NOT NULL DEFAULT 0,
    preference TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    ttft_ms INTEGER NOT NULL DEFAULT 0,
    tps REAL NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    queue_wait_ms INTEGER NOT NULL DEFAULT 0,
    timestamp REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    provider_account_id TEXT,
    session_id TEXT,
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
    billing_account_id TEXT,
    node_id TEXT REFERENCES provider_nodes(node_id),
    issuance_source TEXT NOT NULL DEFAULT 'admin',
    created_at REAL NOT NULL,
    last_used_at REAL,
    connections INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'consumer',
    created_at REAL NOT NULL,
    last_login_at REAL
);

CREATE TABLE IF NOT EXISTS provider_nodes (
    node_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(user_id),
    billing_account_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    declared_profile TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS provider_ownership_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES provider_nodes(node_id),
    billing_account_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_nodes_owner ON provider_nodes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_provider_ownership_actions_node ON provider_ownership_actions(node_id, timestamp);

CREATE TABLE IF NOT EXISTS reference_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    family TEXT NOT NULL DEFAULT '',
    family_key TEXT NOT NULL DEFAULT '',
    input_per_mtok REAL NOT NULL,
    output_per_mtok REAL NOT NULL,
    context_length INTEGER DEFAULT 0,
    fetched_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS account_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    suspended_until REAL,
    actor TEXT NOT NULL,
    timestamp REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ref_family_key ON reference_prices(family_key, fetched_at);
CREATE INDEX IF NOT EXISTS idx_ref_source ON reference_prices(source, fetched_at);
"""

MICRO_PER_DOLLAR = 1_000_000
MIN_CHARGE_MICRO = 100  # BILL-004: $0.0001 per billed request
KEY_PREFIX = "sk-ie-"


class ProviderOwnershipError(Exception):
    """Safe, public error for a rejected provider ownership claim."""

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


class ProviderNodesExist(Exception):
    """Do not delete a user while their provider nodes own billing history."""


class Store:
    """SQLite-backed persistent store for the exchange."""

    PLATFORM_FEE_PERCENT = 10

    def __init__(self, db_path: Path | None = None):
        if db_path is None:
            db_path = Path(os.environ.get("IE_DB_PATH", str(DB_PATH)))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

        # Migrations for existing databases
        self._migrate()

        logger.info(f"Store initialized: {db_path}")

        # Ensure default consumer exists
        self._ensure_account("default-consumer", "Default (anonymous)")

        # Ensure default API key exists, create if not
        self._default_key = self._ensure_default_key()

    def _migrate(self):
        """Apply schema migrations for existing databases."""
        # Add cached_tokens column to transactions (added in v0.2)
        columns = {row[1] for row in self._conn.execute("PRAGMA table_info(transactions)").fetchall()}
        if "cached_tokens" not in columns:
            self._conn.execute("ALTER TABLE transactions ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")
            self._conn.commit()
            logger.info("Migration: added cached_tokens column to transactions")

        # Add enrichment columns to transactions (added for #39)
        new_tx_columns = {
            "provider_name": "TEXT NOT NULL DEFAULT ''",
            "trust_level": "TEXT NOT NULL DEFAULT ''",
            "encrypted": "INTEGER NOT NULL DEFAULT 0",
            "preference": "TEXT NOT NULL DEFAULT ''",
            "latency_ms": "INTEGER NOT NULL DEFAULT 0",
            "ttft_ms": "INTEGER NOT NULL DEFAULT 0",
            "tps": "REAL NOT NULL DEFAULT 0",
            "queued": "INTEGER NOT NULL DEFAULT 0",
            "queue_wait_ms": "INTEGER NOT NULL DEFAULT 0",
            "cost_input_micro": "INTEGER NOT NULL DEFAULT 0",
            "cost_output_micro": "INTEGER NOT NULL DEFAULT 0",
            "cost_cache_micro": "INTEGER NOT NULL DEFAULT 0",
        }
        for col_name, col_def in new_tx_columns.items():
            if col_name not in columns:
                self._conn.execute(f"ALTER TABLE transactions ADD COLUMN {col_name} {col_def}")
                logger.info(f"Migration: added {col_name} column to transactions")
        if any(c not in columns for c in new_tx_columns):
            self._conn.commit()

        # GitHub OAuth identity + server-side session revocation (#69)
        user_columns = {row[1] for row in self._conn.execute("PRAGMA table_info(users)").fetchall()}
        if "github_id" not in user_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN github_id TEXT")
        if "session_version" not in user_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0")
        self._conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)")
        # Account suspension (#111)
        if "suspended_until" not in user_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN suspended_until REAL")
        if "suspension_reason" not in user_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT ''")
        key_columns = {row[1] for row in self._conn.execute("PRAGMA table_info(api_keys)").fetchall()}
        if "revoked_at" not in key_columns:
            self._conn.execute("ALTER TABLE api_keys ADD COLUMN revoked_at REAL")
        self._conn.commit()

        # Provider token revocation (#113)
        pt_columns = {row[1] for row in self._conn.execute("PRAGMA table_info(provider_tokens)").fetchall()}
        if "revoked_at" not in pt_columns:
            self._conn.execute("ALTER TABLE provider_tokens ADD COLUMN revoked_at REAL")
        if "billing_account_id" not in pt_columns:
            self._conn.execute("ALTER TABLE provider_tokens ADD COLUMN billing_account_id TEXT")
        if "node_id" not in pt_columns:
            # Existing provider credentials remain unclaimed. Never guess ownership.
            self._conn.execute("ALTER TABLE provider_tokens ADD COLUMN node_id TEXT REFERENCES provider_nodes(node_id)")
        if "issuance_source" not in pt_columns:
            # Preserve every legacy credential. Only new self-service tokens use the new source.
            self._conn.execute("ALTER TABLE provider_tokens ADD COLUMN issuance_source TEXT NOT NULL DEFAULT 'admin'")
        node_columns = {row[1] for row in self._conn.execute("PRAGMA table_info(provider_nodes)")}
        if "declared_profile" not in node_columns:
            self._conn.execute("ALTER TABLE provider_nodes ADD COLUMN declared_profile TEXT NOT NULL DEFAULT ''")
        # New token IDs have a separate namespace. Do not impose a retroactive unique
        # constraint on historical 8-hex admin IDs or rewrite any existing credential.
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_selfservice_token_id "
            "ON provider_tokens(token_id) WHERE issuance_source = 'self_service'"
        )
        # Every existing credential gets a stable, separate ledger principal. Do
        # not infer shared ownership from the provider's self-reported name and do
        # not merge legacy provider-N accounts or transactions (#136).
        missing = self._conn.execute(
            "SELECT token_hash FROM provider_tokens WHERE billing_account_id IS NULL OR billing_account_id = ''"
        ).fetchall()
        for row in missing:
            account_id = "provider-acct-" + secrets.token_hex(16)
            self._conn.execute(
                "UPDATE provider_tokens SET billing_account_id = ? WHERE token_hash = ?",
                (account_id, row["token_hash"]),
            )
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_tokens_billing_account_id ON provider_tokens(billing_account_id)"
        )
        tx_cols = {r[1] for r in self._conn.execute("PRAGMA table_info(transactions)")}
        if "connection_id" not in tx_cols:
            self._conn.execute("ALTER TABLE transactions ADD COLUMN connection_id TEXT NOT NULL DEFAULT ''")
        hist_cols = {r[1] for r in self._conn.execute("PRAGMA table_info(provider_history)")}
        if "provider_account_id" not in hist_cols:
            self._conn.execute("ALTER TABLE provider_history ADD COLUMN provider_account_id TEXT")
        if "session_id" not in hist_cols:
            self._conn.execute("ALTER TABLE provider_history ADD COLUMN session_id TEXT")
        self._conn.commit()

        # Add cache_per_mtok column to reference_prices (added for three-tier comparison)
        ref_columns = {row[1] for row in self._conn.execute("PRAGMA table_info(reference_prices)").fetchall()}
        if "cache_per_mtok" not in ref_columns:
            self._conn.execute("ALTER TABLE reference_prices ADD COLUMN cache_per_mtok REAL NOT NULL DEFAULT 0")
            self._conn.commit()
            logger.info("Migration: added cache_per_mtok column to reference_prices")

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
            "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL", (key_hash,)
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
            return DEFAULT_CONSUMER_ID
        key = authorization[7:] if authorization.lower().startswith("bearer ") else authorization
        result = self.validate_key(key)
        return result["consumer_id"] if result else DEFAULT_CONSUMER_ID

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
        cached_tokens: int = 0,
        price_per_mtok_cache: float = 0,
        # Enrichment metadata
        provider_name: str = "",
        trust_level: str = "",
        encrypted: bool = False,
        preference: str = "",
        latency_ms: int = 0,
        ttft_ms: int = 0,
        tps: float = 0,
        queued: bool = False,
        queue_wait_ms: int = 0,
        connection_id: str = "",
    ) -> dict | None:
        """Charge consumer, credit provider, log transaction.

        Three-tier pricing: fresh input tokens, cached input tokens, output tokens.
        If price_per_mtok_cache is 0, cached tokens are charged at the input rate.
        """
        cache_rate = price_per_mtok_cache if price_per_mtok_cache > 0 else price_per_mtok_input
        fresh_input = max(0, input_tokens - cached_tokens)
        input_cost = int((fresh_input / 1_000_000) * price_per_mtok_input * MICRO_PER_DOLLAR)
        cache_cost = int((cached_tokens / 1_000_000) * cache_rate * MICRO_PER_DOLLAR)
        output_cost = int((output_tokens / 1_000_000) * price_per_mtok_output * MICRO_PER_DOLLAR)
        total_cost = max(input_cost + cache_cost + output_cost, MIN_CHARGE_MICRO)  # BILL-004

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

        # Log transaction with enrichment metadata
        now = time.time()
        self._conn.execute(
            """INSERT INTO transactions (
                request_id, consumer_id, provider_id, connection_id, provider_name, model,
                input_tokens, output_tokens, cached_tokens,
                cost_micro, cost_input_micro, cost_output_micro, cost_cache_micro,
                provider_earning_micro, platform_fee_micro,
                trust_level, encrypted, preference,
                latency_ms, ttft_ms, tps, queued, queue_wait_ms, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (request_id, consumer_id, provider_id, connection_id, provider_name, model,
             input_tokens, output_tokens, cached_tokens,
             total_cost, input_cost, output_cost, cache_cost,
             provider_earning, platform_fee,
             trust_level, int(encrypted), preference,
             latency_ms, ttft_ms, tps, int(queued), queue_wait_ms, now),
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

    def log_provider_connect(
        self, provider_id: str, name: str, hardware: str, trust_level: str,
        price_output: float, measured_tps: float, *,
        provider_account_id: str = "", session_id: str = "",
    ):
        self._conn.execute(
            """INSERT INTO provider_history (
                provider_id, provider_account_id, session_id, provider_name,
                hardware, trust_level, price_output, measured_tps, connected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (provider_id, provider_account_id or None, session_id or None,
             name, hardware, trust_level, price_output, measured_tps, time.time()),
        )
        self._conn.commit()

    def log_provider_disconnect(self, provider_id: str, *, session_id: str = ""):
        # New connections use a globally unique session ID so an ID reused
        # after coordinator restart cannot close unrelated history rows.
        if session_id:
            self._conn.execute(
                "UPDATE provider_history SET disconnected_at = ? WHERE session_id = ? AND disconnected_at IS NULL",
                (time.time(), session_id),
            )
        else:
            self._conn.execute(
                "UPDATE provider_history SET disconnected_at = ? WHERE provider_id = ? AND disconnected_at IS NULL",
                (time.time(), provider_id),
            )
        self._conn.commit()

    # --- Provider tokens ---

    PROVIDER_TOKEN_PREFIX = "pt-ie-"

    @contextmanager
    def _ownership_write(self):
        """Serialize ownership and account deletion writes across SQLite connections.

        This uses BEGIN IMMEDIATE on a separate connection so that concurrent claims
        cannot both pass a read-before-write check on the shared Store connection.
        Full Store write synchronization is tracked separately in issue #84.
        """
        conn = sqlite3.connect(str(self._db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def claim_legacy_provider(
        self, billing_account_id: str, owner_user_id: str, actor_user_id: str, reason: str,
    ) -> dict:
        """Admin-assisted one-time claim. Never accepts a raw provider token.

        Preserve every existing principal, token hash, ledger amount, and session.
        Claimed principal becomes the immutable accounting identity of this node.
        """
        reason = reason.strip()
        if not reason or len(reason) > 500:
            raise ProviderOwnershipError("A reason of 1-500 characters is required", 400)
        if not billing_account_id.startswith("provider-acct-"):
            raise ProviderOwnershipError("Provider billing principal not found", 404)

        with self._ownership_write() as conn:
            actor = conn.execute("SELECT user_id FROM users WHERE user_id = ?", (actor_user_id,)).fetchone()
            if actor is None:
                raise ProviderOwnershipError("Authenticated administrator required", 403)
            owner = conn.execute(
                "SELECT user_id, github_id, suspended_until FROM users WHERE user_id = ?",
                (owner_user_id,),
            ).fetchone()
            if owner is None:
                raise ProviderOwnershipError("IE user not found", 404)
            if not owner["github_id"]:
                raise ProviderOwnershipError("Owner must have a linked GitHub identity", 409)
            if owner["suspended_until"] is not None and owner["suspended_until"] > time.time():
                raise ProviderOwnershipError("Suspended users cannot claim provider nodes", 409)
            token = conn.execute(
                "SELECT token_hash, name, node_id, revoked_at FROM provider_tokens WHERE billing_account_id = ?",
                (billing_account_id,),
            ).fetchone()
            if token is None:
                raise ProviderOwnershipError("Provider billing principal not found", 404)
            if token["revoked_at"] is not None:
                raise ProviderOwnershipError("Revoked credentials cannot be claimed", 409)
            if token["node_id"] is not None or conn.execute(
                "SELECT 1 FROM provider_nodes WHERE billing_account_id = ?", (billing_account_id,)
            ).fetchone():
                raise ProviderOwnershipError("Provider billing principal is already claimed", 409)

            node_id = "node-" + secrets.token_hex(16)
            created_at = time.time()
            conn.execute(
                """INSERT INTO provider_nodes
                   (node_id, owner_user_id, billing_account_id, name, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (node_id, owner_user_id, billing_account_id, token["name"], created_at),
            )
            updated = conn.execute(
                """UPDATE provider_tokens SET node_id = ?
                   WHERE token_hash = ? AND node_id IS NULL AND revoked_at IS NULL""",
                (node_id, token["token_hash"]),
            )
            if updated.rowcount != 1:
                raise ProviderOwnershipError("Provider claim changed concurrently", 409)
            conn.execute(
                """INSERT INTO provider_ownership_actions
                   (node_id, billing_account_id, owner_user_id, actor_user_id, action, reason, timestamp)
                   VALUES (?, ?, ?, ?, 'claim', ?, ?)""",
                (node_id, billing_account_id, owner_user_id, actor_user_id, reason, created_at),
            )
            return {
                "node_id": node_id, "owner_user_id": owner_user_id,
                "billing_account_id": billing_account_id, "name": token["name"],
            }

    def is_github_linked_user(self, user_id: str) -> bool:
        row = self._conn.execute(
            "SELECT github_id FROM users WHERE user_id = ?", (user_id,),
        ).fetchone()
        return bool(row and row["github_id"])

    def get_provider_node_owner(self, node_id: str, billing_account_id: str) -> str | None:
        """A token must match both its node and its immutable billing principal."""
        row = self._conn.execute(
            "SELECT owner_user_id FROM provider_nodes WHERE node_id = ? AND billing_account_id = ?",
            (node_id, billing_account_id),
        ).fetchone()
        return row["owner_user_id"] if row else None

    def provider_billing_principals_for_owner(self, owner_user_id: str) -> set[str]:
        rows = self._conn.execute(
            "SELECT billing_account_id FROM provider_nodes WHERE owner_user_id = ?",
            (owner_user_id,),
        ).fetchall()
        return {row["billing_account_id"] for row in rows}


    def list_owned_provider_nodes(self, owner_user_id: str) -> list[dict]:
        """Return only nodes owned by this IE user. Do not return credentials."""
        rows = self._conn.execute(
            """SELECT n.node_id, n.billing_account_id, n.name, n.created_at,
                      COALESCE(a.total_earned_micro, 0) AS ledger_earned_micro
               FROM provider_nodes n
               LEFT JOIN accounts a ON a.account_id = n.billing_account_id
               WHERE n.owner_user_id = ?
               ORDER BY n.created_at, n.node_id""",
            (owner_user_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_owned_provider_earnings(
        self, owner_user_id: str, *, node_id: str | None = None,
        limit: int = 50, before_id: int | None = None,
    ) -> dict | None:
        """Exact read-only ledger view. Return None if the node is not owned.

        Do not derive earnings from balance_micro. Each provider account begins
        with simulated credits unrelated to the amount earned from requests.
        """
        nodes = self.list_owned_provider_nodes(owner_user_id)
        if node_id is not None:
            nodes = [node for node in nodes if node["node_id"] == node_id]
            if not nodes:
                return None

        if not 1 <= limit <= 100 or (before_id is not None and before_id < 1):
            raise ValueError("Invalid pagination")

        if not nodes:
            return {
                "summary": {
                    "earned_micro": 0, "ledger_earned_micro": 0,
                    "today_earned_micro": 0, "cost_micro": 0,
                    "platform_fee_micro": 0, "requests_served": 0,
                    "reconciled": True,
                },
                "by_node": [], "transactions": [], "next_before_id": None,
            }

        # Sum only the principals belonging to this owner. Never join a
        # provider by its display name or transient WebSocket routing ID.
        principals = [node["billing_account_id"] for node in nodes]
        placeholders = ", ".join("?" for _ in principals)
        utc_midnight = int(time.time() // 86400) * 86400
        totals = self._conn.execute(
            f"""SELECT provider_id, COUNT(*) AS requests_served,
                       COALESCE(SUM(provider_earning_micro), 0) AS earned_micro,
                       COALESCE(SUM(platform_fee_micro), 0) AS platform_fee_micro,
                       COALESCE(SUM(cost_micro), 0) AS cost_micro,
                       COALESCE(SUM(CASE WHEN timestamp >= ? THEN provider_earning_micro ELSE 0 END), 0)
                           AS today_earned_micro
                FROM transactions
                WHERE provider_id IN ({placeholders})
                GROUP BY provider_id""",
            [utc_midnight, *principals],
        ).fetchall()
        per_principal = {row["provider_id"]: dict(row) for row in totals}
        by_node = []
        for node in nodes:
            s = per_principal.get(node["billing_account_id"], {})
            earned = s.get("earned_micro", 0)
            ledger = node["ledger_earned_micro"]
            by_node.append({
                "node_id": node["node_id"],
                "name": node["name"],
                "earned_micro": earned,
                "ledger_earned_micro": ledger,
                "today_earned_micro": s.get("today_earned_micro", 0),
                "platform_fee_micro": s.get("platform_fee_micro", 0),
                "cost_micro": s.get("cost_micro", 0),
                "requests_served": s.get("requests_served", 0),
                "reconciled": earned == ledger,
            })

        summary = {
            key: sum(item[key] for item in by_node)
            for key in ("earned_micro", "ledger_earned_micro", "today_earned_micro",
                        "platform_fee_micro", "cost_micro", "requests_served")
        }
        summary["reconciled"] = all(item["reconciled"] for item in by_node)

        # Return only provider-side metadata. In particular, no consumer_id,
        # request_id, session ID, prompt text, token hash, or raw token.
        params = [owner_user_id]
        filter_sql = ""
        if node_id is not None:
            filter_sql += " AND n.node_id = ?"
            params.append(node_id)
        if before_id is not None:
            filter_sql += " AND t.id < ?"
            params.append(before_id)
        rows = self._conn.execute(
            f"""SELECT t.id, n.node_id, t.timestamp, t.model,
                       t.input_tokens, t.output_tokens, t.cached_tokens,
                       t.cost_micro, t.provider_earning_micro, t.platform_fee_micro
                FROM transactions t
                JOIN provider_nodes n ON n.billing_account_id = t.provider_id
                WHERE n.owner_user_id = ? {filter_sql}
                ORDER BY t.id DESC LIMIT ?""",
            [*params, limit + 1],
        ).fetchall()
        has_more = len(rows) > limit
        page = [dict(row) for row in rows[:limit]]
        return {
            "summary": summary,
            "by_node": by_node,
            "transactions": page,
            "next_before_id": page[-1]["id"] if has_more and page else None,
        }

    SELF_SERVICE_PROFILE = "apple-silicon-macos-gguf-metal-l0"
    SELF_SERVICE_DAILY_ISSUANCE_LIMIT = 3

    def enroll_provider_node(self, owner_user_id: str, name: str, profile: str) -> dict:
        """Create a GitHub user's node, billing principal and credential atomically.

        Uses a separate BEGIN IMMEDIATE transaction to serialize cap checks across
        coordinator requests and independent SQLite connections. No live migration
        or historical principal change occurs here.
        """
        import re
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}", name):
            raise ProviderOwnershipError("Invalid provider name", 400)
        if profile != self.SELF_SERVICE_PROFILE:
            raise ProviderOwnershipError("Unsupported provider profile", 400)

        now = time.time()
        raw = self.PROVIDER_TOKEN_PREFIX + secrets.token_hex(32)
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        with self._ownership_write() as conn:
            user = conn.execute(
                "SELECT github_id, suspended_until FROM users WHERE user_id = ?", (owner_user_id,),
            ).fetchone()
            if user is None:
                raise ProviderOwnershipError("Authenticated IE user required", 403)
            if not user["github_id"]:
                raise ProviderOwnershipError("A linked GitHub identity is required", 403)
            if user["suspended_until"] is not None and user["suspended_until"] > now:
                raise ProviderOwnershipError("Account suspended", 403)
            active = conn.execute(
                """SELECT COUNT(*) FROM provider_tokens t JOIN provider_nodes n ON t.node_id = n.node_id
                   WHERE n.owner_user_id = ? AND t.issuance_source = 'self_service'
                   AND t.revoked_at IS NULL""",
                (owner_user_id,),
            ).fetchone()[0]
            if active >= 1:
                raise ProviderOwnershipError("Active self-service provider node limit reached", 409)
            issued = conn.execute(
                """SELECT COUNT(*) FROM provider_tokens t JOIN provider_nodes n ON t.node_id = n.node_id
                   WHERE n.owner_user_id = ? AND t.issuance_source = 'self_service'
                   AND t.created_at >= ?""",
                (owner_user_id, now - 86400),
            ).fetchone()[0]
            if issued >= self.SELF_SERVICE_DAILY_ISSUANCE_LIMIT:
                raise ProviderOwnershipError("Daily provider enrollment limit reached", 429)
            node_id = "node-" + secrets.token_hex(16)
            billing_account_id = "provider-acct-" + secrets.token_hex(16)
            token_id = "ptok-" + secrets.token_hex(16)
            conn.execute(
                """INSERT INTO accounts
                   (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)""",
                (billing_account_id, name, 10 * MICRO_PER_DOLLAR, now),
            )
            conn.execute(
                """INSERT INTO provider_nodes
                   (node_id, owner_user_id, billing_account_id, name, created_at, declared_profile)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (node_id, owner_user_id, billing_account_id, name, now, profile),
            )
            conn.execute(
                """INSERT INTO provider_tokens
                   (token_hash, token_id, name, billing_account_id, node_id,
                    issuance_source, created_at)
                   VALUES (?, ?, ?, ?, ?, 'self_service', ?)""",
                (token_hash, token_id, name, billing_account_id, node_id, now),
            )
            conn.execute(
                """INSERT INTO provider_ownership_actions
                   (node_id, billing_account_id, owner_user_id, actor_user_id,
                    action, reason, timestamp)
                   VALUES (?, ?, ?, ?, 'enroll', 'self-service L0 Apple Silicon enrollment', ?)""",
                (node_id, billing_account_id, owner_user_id, owner_user_id, now),
            )
        logger.info("Self-service provider node enrolled: %s", node_id)
        return {
            "node": {"node_id": node_id, "name": name, "status": "offline", "profile": profile},
            "credential": {"token_id": token_id, "token": raw},
            "simulated_credits": True,
        }

    def create_provider_token(self, name: str = "Provider") -> str:
        """Create a provider auth token. Returns the raw token (shown once)."""
        raw = self.PROVIDER_TOKEN_PREFIX + secrets.token_hex(16)
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        token_id = token_hash[:8]
        # A credential is a billing principal until user-owned provider
        # identities and explicit token rotation are implemented (#9).
        billing_account_id = "provider-acct-" + secrets.token_hex(16)
        self._conn.execute(
            """INSERT INTO provider_tokens
                (token_hash, token_id, name, billing_account_id, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            (token_hash, token_id, name, billing_account_id, time.time()),
        )
        self._conn.commit()
        logger.info("Administrative provider credential created: %s", token_id)
        return raw

    def validate_provider_token(self, raw_token: str) -> dict | None:
        """Validate a provider token. Returns metadata or None."""
        if not raw_token or not raw_token.startswith(self.PROVIDER_TOKEN_PREFIX):
            return None
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        row = self._conn.execute(
            "SELECT * FROM provider_tokens WHERE token_hash = ? AND revoked_at IS NULL", (token_hash,)
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
            "SELECT token_id, name, billing_account_id, created_at, last_used_at, connections, revoked_at FROM provider_tokens"
        ).fetchall()
        return [dict(r) for r in rows]

    def revoke_provider_token(self, token_id: str) -> bool:
        cur = self._conn.execute(
            "UPDATE provider_tokens SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL",
            (time.time(), token_id),
        )
        self._conn.commit()
        if cur.rowcount:
            logger.warning(f"Provider token revoked: {token_id}")
        return cur.rowcount > 0


    # --- User accounts ---

    def create_user(self, email: str, password: str, name: str = "") -> dict:
        """Create a user with email/password. Returns user dict.

        Also creates a billing account and a default API key for the user.
        Raises ValueError if email already exists.
        """
        import hashlib as _h

        user_id = f"user-{secrets.token_hex(4)}"
        # Hash password with salt (SHA-256 + salt, sufficient for alpha)
        salt = secrets.token_hex(16)
        pw_hash = _h.sha256(f"{salt}:{password}".encode()).hexdigest()
        password_hash = f"{salt}:{pw_hash}"

        try:
            self._conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email.lower().strip(), password_hash, name or email.split("@")[0], time.time()),
            )
        except sqlite3.IntegrityError:
            raise ValueError(f"Email already registered: {email}")

        # Create billing account for this user
        consumer_id = user_id  # user_id IS the consumer_id
        self._conn.execute(
            "INSERT INTO accounts (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)",
            (consumer_id, name or email.split("@")[0], 10 * MICRO_PER_DOLLAR, time.time()),
        )

        # Create a default API key for this user
        raw_key = KEY_PREFIX + secrets.token_hex(16)
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key_id = key_hash[:8]
        self._conn.execute(
            "INSERT INTO api_keys (key_hash, key_id, consumer_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (key_hash, key_id, consumer_id, "Default Key", time.time()),
        )
        self._conn.commit()

        logger.info(f"User created: {email} -> {user_id}")
        return {
            "user_id": user_id,
            "email": email.lower().strip(),
            "name": name or email.split("@")[0],
            "api_key": raw_key,
        }

    def authenticate_user(self, email: str, password: str) -> dict | None:
        """Authenticate by email + password. Returns user dict or None."""
        import hashlib as _h

        row = self._conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
        if not row:
            return None

        stored = row["password_hash"]
        if ":" not in stored:  # OAuth-only account, no password set
            return None
        salt, expected_hash = stored.split(":", 1)
        actual_hash = _h.sha256(f"{salt}:{password}".encode()).hexdigest()
        if not hmac.compare_digest(actual_hash, expected_hash):
            return None

        # Update last login
        self._conn.execute(
            "UPDATE users SET last_login_at = ? WHERE user_id = ?",
            (time.time(), row["user_id"]),
        )
        self._conn.commit()

        return {
            "user_id": row["user_id"],
            "email": row["email"],
            "name": row["name"],
            "role": row["role"],
            "session_version": row["session_version"],
        }

    def upsert_github_user(self, github_id: str, login: str, email: str, name: str) -> tuple[dict, bool]:
        """Find or create the user for a GitHub identity. Returns (user, created)."""
        row = self._conn.execute("SELECT * FROM users WHERE github_id = ?", (github_id,)).fetchone()
        now = time.time()
        if row:
            self._conn.execute("UPDATE users SET last_login_at = ? WHERE user_id = ?", (now, row["user_id"]))
            self._conn.commit()
            return {k: row[k] for k in ("user_id", "email", "name", "role", "session_version")}, False

        user_id = f"user-{secrets.token_hex(4)}"
        # GitHub may hide the email; fall back to a unique placeholder so the UNIQUE constraint holds
        email = (email or f"{login}@users.noreply.github.com").lower().strip()
        name = name or login
        try:
            self._conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, created_at, last_login_at, github_id) VALUES (?, ?, '', ?, ?, ?, ?)",
                (user_id, email, name, now, now, github_id),
            )
        except sqlite3.IntegrityError:
            raise ValueError(f"Email already registered with a password account: {email}")
        self._conn.execute(
            "INSERT INTO accounts (account_id, name, balance_micro, created_at) VALUES (?, ?, ?, ?)",
            (user_id, name, 10 * MICRO_PER_DOLLAR, now),
        )
        self._conn.commit()
        logger.info(f"GitHub user created: {login} -> {user_id}")
        return {"user_id": user_id, "email": email, "name": name, "role": "consumer", "session_version": 0}, True

    def has_github_user(self, github_id: str) -> bool:
        return bool(self._conn.execute("SELECT 1 FROM users WHERE github_id = ?", (github_id,)).fetchone())

    def get_session_version(self, user_id: str) -> int | None:
        row = self._conn.execute("SELECT session_version FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return row["session_version"] if row else None

    def bump_session_version(self, user_id: str) -> None:
        """Invalidate every session issued to this user."""
        self._conn.execute("UPDATE users SET session_version = session_version + 1 WHERE user_id = ?", (user_id,))
        self._conn.commit()

    def revoke_api_key(self, user_id: str, key_id: str) -> bool:
        cur = self._conn.execute(
            "UPDATE api_keys SET revoked_at = ? WHERE consumer_id = ? AND key_id = ? AND revoked_at IS NULL",
            (time.time(), user_id, key_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_user(self, user_id: str) -> None:
        """Delete a consumer account, unless it still owns provider billing nodes."""
        with self._ownership_write() as conn:
            if conn.execute(
                "SELECT 1 FROM provider_nodes WHERE owner_user_id = ? LIMIT 1", (user_id,)
            ).fetchone():
                raise ProviderNodesExist()
            conn.execute("DELETE FROM api_keys WHERE consumer_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM accounts WHERE account_id = ?", (user_id,) )

    # --- Account suspension (#111) ---

    # suspended_until at or above this value means a permanent ban
    PERMANENT_SUSPENSION = 1e18

    def suspend_user(self, user_id: str, reason: str, actor: str, duration_seconds: float | None) -> dict | None:
        """Suspend a user. duration_seconds=None is a permanent ban. Ends all sessions."""
        if not self.get_user(user_id):
            return None
        now = time.time()
        until = self.PERMANENT_SUSPENSION if duration_seconds is None else now + duration_seconds
        self._conn.execute(
            "UPDATE users SET suspended_until = ?, suspension_reason = ?, session_version = session_version + 1 WHERE user_id = ?",
            (until, reason, user_id),
        )
        self._conn.execute(
            "INSERT INTO account_actions (user_id, action, reason, suspended_until, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, "ban" if duration_seconds is None else "suspend", reason, until, actor, now),
        )
        self._conn.commit()
        logger.info(f"Account {user_id} suspended by {actor}")
        return self.get_suspension(user_id)

    def unsuspend_user(self, user_id: str, reason: str, actor: str) -> bool:
        cur = self._conn.execute(
            "UPDATE users SET suspended_until = NULL, suspension_reason = '' WHERE user_id = ?", (user_id,),
        )
        if cur.rowcount == 0:
            return False
        self._conn.execute(
            "INSERT INTO account_actions (user_id, action, reason, actor, timestamp) VALUES (?, 'unsuspend', ?, ?, ?)",
            (user_id, reason, actor, time.time()),
        )
        self._conn.commit()
        logger.info(f"Account {user_id} unsuspended by {actor}")
        return True

    def get_suspension(self, user_id: str) -> dict | None:
        """Active suspension for this account, or None. An expired suspension is inactive."""
        row = self._conn.execute(
            "SELECT suspended_until, suspension_reason FROM users WHERE user_id = ?", (user_id,),
        ).fetchone()
        if not row or row["suspended_until"] is None or row["suspended_until"] <= time.time():
            return None
        permanent = row["suspended_until"] >= self.PERMANENT_SUSPENSION
        return {
            "user_id": user_id,
            "reason": row["suspension_reason"],
            "permanent": permanent,
            "suspended_until": None if permanent else row["suspended_until"],
        }

    def list_users_for_admin(self, limit: int = 500) -> list[dict]:
        """Account metadata for operators. No password hashes, no key material."""
        rows = self._conn.execute(
            """SELECT u.user_id, u.email, u.name, u.role, u.created_at, u.last_login_at,
                      u.suspended_until, u.suspension_reason,
                      (SELECT COUNT(*) FROM api_keys k WHERE k.consumer_id = u.user_id AND k.revoked_at IS NULL) AS active_keys,
                      (SELECT MAX(k.last_used_at) FROM api_keys k WHERE k.consumer_id = u.user_id) AS key_last_used_at,
                      a.requests_made, a.tokens_consumed
               FROM users u LEFT JOIN accounts a ON a.account_id = u.user_id
               ORDER BY u.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        now = time.time()
        result = []
        for r in rows:
            d = dict(r)
            until = d.pop("suspended_until")
            d["suspended"] = until is not None and until > now
            d["suspension_permanent"] = d["suspended"] and until >= self.PERMANENT_SUSPENSION
            d["suspended_until"] = until if d["suspended"] and not d["suspension_permanent"] else None
            if not d["suspended"]:
                d["suspension_reason"] = ""
            result.append(d)
        return result

    def list_account_actions(self, user_id: str | None = None, limit: int = 200) -> list[dict]:
        if user_id:
            rows = self._conn.execute(
                "SELECT * FROM account_actions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?", (user_id, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM account_actions ORDER BY timestamp DESC LIMIT ?", (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_user(self, user_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT user_id, email, name, role, created_at FROM users WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        return dict(row) if row else None

    def has_users(self) -> bool:
        return bool(self._conn.execute("SELECT 1 FROM users LIMIT 1").fetchone())

    def get_user_api_keys(self, user_id: str) -> list[dict]:
        """Get all API keys belonging to a user."""
        rows = self._conn.execute(
            "SELECT key_id, name, created_at, last_used_at, requests_made FROM api_keys WHERE consumer_id = ? AND revoked_at IS NULL",
            (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def create_api_key_for_user(self, user_id: str, name: str = "API Key") -> str:
        """Create a new API key tied to an existing user's account. Returns raw key."""
        raw = KEY_PREFIX + secrets.token_hex(16)
        key_hash = hashlib.sha256(raw.encode()).hexdigest()
        key_id = key_hash[:8]
        self._conn.execute(
            "INSERT INTO api_keys (key_hash, key_id, consumer_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (key_hash, key_id, user_id, name, time.time()),
        )
        self._conn.commit()
        return raw
