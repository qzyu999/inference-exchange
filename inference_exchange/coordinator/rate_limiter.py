"""Per-key token bucket rate limiter.

Prevents a single consumer from exhausting all provider capacity.
Each API key gets a bucket that refills at a steady rate.
"""

import time
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TokenBucket:
    """A token bucket for rate limiting."""

    max_tokens: float  # Maximum burst capacity
    refill_rate: float  # Tokens added per second
    tokens: float = field(init=False)
    last_refill: float = field(default_factory=time.time)

    def __post_init__(self):
        self.tokens = self.max_tokens

    def consume(self, amount: float = 1.0) -> bool:
        """Try to consume tokens. Returns True if allowed, False if rate limited."""
        now = time.time()
        # Refill tokens based on elapsed time
        elapsed = now - self.last_refill
        self.tokens = min(self.max_tokens, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False

    @property
    def remaining(self) -> float:
        """Tokens currently available."""
        now = time.time()
        elapsed = now - self.last_refill
        return min(self.max_tokens, self.tokens + elapsed * self.refill_rate)


class RateLimiter:
    """Per-consumer rate limiter using token buckets.

    Default: 30 requests per minute (burst up to 10).
    """

    def __init__(self, max_requests_per_minute: float = 30, burst: int = 10):
        self._buckets: dict[str, TokenBucket] = {}
        self._max_rpm = max_requests_per_minute
        self._burst = burst
        self._refill_rate = max_requests_per_minute / 60.0  # per second

    def allow(self, consumer_id: str) -> bool:
        """Check if a request from this consumer is allowed."""
        if consumer_id not in self._buckets:
            self._buckets[consumer_id] = TokenBucket(
                max_tokens=self._burst,
                refill_rate=self._refill_rate,
            )
        return self._buckets[consumer_id].consume()

    def remaining(self, consumer_id: str) -> float:
        """How many requests the consumer can still make right now."""
        if consumer_id not in self._buckets:
            return self._burst
        return self._buckets[consumer_id].remaining

    def reset(self, consumer_id: str):
        """Reset a consumer's bucket (e.g., on key regeneration)."""
        self._buckets.pop(consumer_id, None)
