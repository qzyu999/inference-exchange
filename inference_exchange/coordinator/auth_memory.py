"""Legacy in-memory auth, used by tests only. Production uses store.py.

API key authentication — multi-tenant consumer identity.

Keys follow the format: sk-ie-<32 hex chars>
Each key is tied to a consumer account with its own balance and usage.

Keys are stored in-memory (lost on restart). Production would use a DB.
"""

import hashlib
import logging
import secrets
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

KEY_PREFIX = "sk-ie-"


@dataclass
class ApiKey:
    """A consumer API key."""

    key_id: str  # Short ID for display (first 8 chars of hash)
    key_hash: str  # SHA-256 of the full key (we never store plaintext)
    consumer_id: str  # Links to billing account
    name: str  # Human-readable label
    created_at: float = field(default_factory=time.time)
    last_used_at: float | None = None
    requests_made: int = 0


class AuthStore:
    """Manages API keys and resolves consumer identity from requests."""

    def __init__(self):
        self._keys_by_hash: dict[str, ApiKey] = {}
        # Create a default key so the system works out-of-the-box
        self._default_key = self._create_key_internal("default-consumer", "Default Key")
        logger.info(f"Default API key created: {self._default_key}")

    def _hash_key(self, raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode()).hexdigest()

    def _create_key_internal(self, consumer_id: str, name: str) -> str:
        """Create a key and return the raw key string (only time it's visible)."""
        raw = KEY_PREFIX + secrets.token_hex(16)
        key_hash = self._hash_key(raw)
        key_id = key_hash[:8]

        self._keys_by_hash[key_hash] = ApiKey(
            key_id=key_id,
            key_hash=key_hash,
            consumer_id=consumer_id,
            name=name,
        )
        return raw

    def create_key(self, name: str = "API Key") -> tuple[str, str]:
        """Create a new API key. Returns (raw_key, consumer_id).

        The raw_key is shown once and never stored. The consumer gets their own
        billing account.
        """
        consumer_id = f"consumer-{secrets.token_hex(4)}"
        raw = self._create_key_internal(consumer_id, name)
        logger.info(f"API key created: {raw[:12]}... for {consumer_id} ({name})")
        return raw, consumer_id

    def validate_key(self, raw_key: str) -> ApiKey | None:
        """Validate a key and return the ApiKey record, or None if invalid."""
        if not raw_key or not raw_key.startswith(KEY_PREFIX):
            return None

        key_hash = self._hash_key(raw_key)
        api_key = self._keys_by_hash.get(key_hash)

        if api_key:
            api_key.last_used_at = time.time()
            api_key.requests_made += 1

        return api_key

    def resolve_consumer(self, authorization: str | None) -> str:
        """Resolve a consumer_id from an Authorization header.

        Accepts: "Bearer sk-ie-..." or just "sk-ie-..."
        Falls back to "default-consumer" if no auth or invalid.
        """
        if not authorization:
            return "default-consumer"

        # Strip "Bearer " prefix if present
        key = authorization
        if key.lower().startswith("bearer "):
            key = key[7:]

        api_key = self.validate_key(key)
        if api_key:
            return api_key.consumer_id

        # Invalid key — fall back to default for now
        # (Production would return 401)
        return "default-consumer"

    def list_keys(self) -> list[dict]:
        """List all keys (without raw values — only metadata)."""
        return [
            {
                "key_id": k.key_id,
                "name": k.name,
                "consumer_id": k.consumer_id,
                "created_at": k.created_at,
                "last_used_at": k.last_used_at,
                "requests_made": k.requests_made,
            }
            for k in self._keys_by_hash.values()
        ]

    @property
    def default_key(self) -> str:
        """The default key (for the UI to auto-use)."""
        return self._default_key
