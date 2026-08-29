"""Tests for per-consumer token bucket rate limiting."""

import time

import pytest

from inference_exchange.coordinator.rate_limiter import RateLimiter, TokenBucket


# ---------------------------------------------------------------------------
# Burst allows N immediate requests
# ---------------------------------------------------------------------------

class TestBurst:
    def test_burst_allows_exact_count(self):
        """A fresh bucket allows exactly `burst` immediate requests."""
        limiter = RateLimiter(max_requests_per_minute=60, burst=5)
        results = [limiter.allow("c1") for _ in range(5)]
        assert all(results)

    def test_burst_default_ten(self):
        """Default burst is 10."""
        limiter = RateLimiter()
        results = [limiter.allow("c1") for _ in range(10)]
        assert all(results)

    def test_burst_one(self):
        limiter = RateLimiter(burst=1)
        assert limiter.allow("c1") is True


# ---------------------------------------------------------------------------
# Exceeding rate returns False
# ---------------------------------------------------------------------------

class TestExceedingRate:
    def test_exceeds_burst_returns_false(self):
        limiter = RateLimiter(max_requests_per_minute=60, burst=3)
        for _ in range(3):
            limiter.allow("c1")
        assert limiter.allow("c1") is False

    def test_remaining_drops_to_zero(self):
        limiter = RateLimiter(burst=5)
        for _ in range(5):
            limiter.allow("c1")
        assert limiter.remaining("c1") < 1.0

    def test_consecutive_denials(self):
        limiter = RateLimiter(burst=2)
        limiter.allow("c1")
        limiter.allow("c1")
        assert limiter.allow("c1") is False
        assert limiter.allow("c1") is False


# ---------------------------------------------------------------------------
# Tokens refill over time
# ---------------------------------------------------------------------------

class TestTokenRefill:
    def test_refill_after_time(self):
        """After exhaust + wait, tokens should refill."""
        bucket = TokenBucket(max_tokens=5, refill_rate=10.0)
        # Exhaust all tokens
        for _ in range(5):
            bucket.consume()
        assert not bucket.consume()

        # Simulate time passing by adjusting last_refill
        bucket.last_refill -= 1.0  # 1 second in the past → +10 tokens
        assert bucket.consume()

    def test_refill_does_not_exceed_max(self):
        """Tokens cannot exceed max_tokens even after long wait."""
        bucket = TokenBucket(max_tokens=5, refill_rate=100.0)
        bucket.last_refill -= 100.0  # way in the past
        assert bucket.remaining <= 5.0

    def test_limiter_refills(self):
        """The limiter's buckets also refill over time."""
        limiter = RateLimiter(max_requests_per_minute=600, burst=2)
        limiter.allow("c1")
        limiter.allow("c1")
        assert limiter.allow("c1") is False

        # Manually adjust the bucket's last_refill to simulate time passing
        bucket = limiter._buckets["c1"]
        bucket.last_refill -= 1.0  # 1 second ago → +10 tokens
        assert limiter.allow("c1") is True


# ---------------------------------------------------------------------------
# Per-consumer isolation
# ---------------------------------------------------------------------------

class TestConsumerIsolation:
    def test_separate_buckets(self):
        """One consumer's exhaustion doesn't affect another."""
        limiter = RateLimiter(burst=3)
        # Exhaust consumer A
        for _ in range(3):
            limiter.allow("A")
        assert limiter.allow("A") is False

        # Consumer B should still be fresh
        assert limiter.allow("B") is True

    def test_many_consumers_independent(self):
        limiter = RateLimiter(burst=2)
        for cid in ["c1", "c2", "c3", "c4", "c5"]:
            assert limiter.allow(cid) is True
            assert limiter.allow(cid) is True
            assert limiter.allow(cid) is False

    def test_reset_only_affects_target(self):
        limiter = RateLimiter(burst=2)
        limiter.allow("A")
        limiter.allow("A")
        limiter.allow("B")
        limiter.allow("B")

        limiter.reset("A")
        assert limiter.allow("A") is True  # Reset → fresh bucket
        assert limiter.allow("B") is False  # Still exhausted

    def test_remaining_for_unknown_consumer(self):
        limiter = RateLimiter(burst=7)
        assert limiter.remaining("nobody") == 7
