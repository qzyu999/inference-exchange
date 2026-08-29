"""Tests for provider reputation tracking — EMA scoring and degradation."""

import pytest

from inference_exchange.coordinator.reputation import (
    ProviderReputation,
    ReputationTracker,
    RequestOutcome,
)


# ---------------------------------------------------------------------------
# New providers start at neutral (0.5)
# ---------------------------------------------------------------------------

class TestInitialReputation:
    def test_new_provider_score_is_neutral(self):
        rep = ProviderReputation(provider_id="p1")
        assert rep.score == 0.5

    def test_new_provider_ema_starts_at_half(self):
        rep = ProviderReputation(provider_id="p1")
        assert rep.success_rate_ema == 0.5
        assert rep.latency_score_ema == 0.5

    def test_tracker_creates_neutral_provider(self):
        tracker = ReputationTracker()
        assert tracker.get_score("new-provider") == 0.5


# ---------------------------------------------------------------------------
# Successes increase score toward 1.0
# ---------------------------------------------------------------------------

class TestSuccessIncreases:
    def test_single_success_increases_ema(self):
        rep = ProviderReputation(provider_id="p1")
        old_ema = rep.success_rate_ema
        rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=200)
        assert rep.success_rate_ema > old_ema

    def test_many_successes_approach_one(self):
        rep = ProviderReputation(provider_id="p1")
        for _ in range(100):
            rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        assert rep.success_rate_ema > 0.99

    def test_score_increases_with_successes(self):
        tracker = ReputationTracker()
        for _ in range(20):
            tracker.record_success("p1", latency_ms=200)
        score = tracker.get_score("p1")
        assert score > 0.5


# ---------------------------------------------------------------------------
# Failures decrease score toward 0.0
# ---------------------------------------------------------------------------

class TestFailureDecreases:
    def test_single_error_decreases_ema(self):
        rep = ProviderReputation(provider_id="p1")
        old_ema = rep.success_rate_ema
        rep.record_outcome(RequestOutcome.ERROR)
        assert rep.success_rate_ema < old_ema

    def test_many_errors_approach_zero(self):
        rep = ProviderReputation(provider_id="p1")
        for _ in range(100):
            rep.record_outcome(RequestOutcome.ERROR)
        assert rep.success_rate_ema < 0.01

    def test_timeout_decreases_both_emas(self):
        rep = ProviderReputation(provider_id="p1")
        old_success = rep.success_rate_ema
        old_latency = rep.latency_score_ema
        rep.record_outcome(RequestOutcome.TIMEOUT)
        assert rep.success_rate_ema < old_success
        assert rep.latency_score_ema < old_latency

    def test_disconnect_decreases_success_ema(self):
        rep = ProviderReputation(provider_id="p1")
        old_ema = rep.success_rate_ema
        rep.record_outcome(RequestOutcome.DISCONNECT)
        assert rep.success_rate_ema < old_ema


# ---------------------------------------------------------------------------
# Degraded flag triggers after 5+ requests with <50% success
# ---------------------------------------------------------------------------

class TestDegradedFlag:
    def test_not_degraded_with_few_requests(self):
        """Need at least 5 requests before degraded triggers."""
        rep = ProviderReputation(provider_id="p1")
        for _ in range(4):
            rep.record_outcome(RequestOutcome.ERROR)
        assert not rep.is_degraded

    def test_degraded_after_five_failures(self):
        """5 straight errors should set success_rate_ema well below 0.5."""
        rep = ProviderReputation(provider_id="p1")
        for _ in range(5):
            rep.record_outcome(RequestOutcome.ERROR)
        assert rep.is_degraded

    def test_not_degraded_if_mostly_success(self):
        rep = ProviderReputation(provider_id="p1")
        for _ in range(10):
            rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        rep.record_outcome(RequestOutcome.ERROR)
        assert not rep.is_degraded

    def test_tracker_reports_degraded(self):
        tracker = ReputationTracker()
        for _ in range(10):
            tracker.record_error("bad-provider")
        assert tracker.is_degraded("bad-provider")


# ---------------------------------------------------------------------------
# Recovery after a bad streak
# ---------------------------------------------------------------------------

class TestRecovery:
    def test_recovery_from_errors(self):
        """A provider that starts failing then improves should recover."""
        rep = ProviderReputation(provider_id="p1")

        # Bad streak
        for _ in range(10):
            rep.record_outcome(RequestOutcome.ERROR)
        assert rep.is_degraded
        low_ema = rep.success_rate_ema

        # Recovery
        for _ in range(50):
            rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        assert rep.success_rate_ema > low_ema
        assert rep.success_rate_ema > 0.5
        assert not rep.is_degraded

    def test_score_recovers_past_neutral(self):
        tracker = ReputationTracker()
        # Damage
        for _ in range(10):
            tracker.record_error("p1")
        damaged_score = tracker.get_score("p1")

        # Recover
        for _ in range(50):
            tracker.record_success("p1", latency_ms=100)
        recovered_score = tracker.get_score("p1")
        assert recovered_score > damaged_score
        assert recovered_score > 0.5


# ---------------------------------------------------------------------------
# EMA responsiveness — recent outcomes matter more
# ---------------------------------------------------------------------------

class TestEMAResponsiveness:
    def test_recent_failure_drops_score_quickly(self):
        """After a long success streak, a few failures should visibly drop the EMA."""
        rep = ProviderReputation(provider_id="p1")
        for _ in range(50):
            rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        high_ema = rep.success_rate_ema

        # Just 3 failures
        for _ in range(3):
            rep.record_outcome(RequestOutcome.ERROR)
        assert rep.success_rate_ema < high_ema

    def test_recent_success_raises_score_quickly(self):
        """After a failure streak, a few successes should visibly raise the EMA."""
        rep = ProviderReputation(provider_id="p1")
        for _ in range(20):
            rep.record_outcome(RequestOutcome.ERROR)
        low_ema = rep.success_rate_ema

        # Just 3 successes
        for _ in range(3):
            rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        assert rep.success_rate_ema > low_ema

    def test_alpha_weight(self):
        """Verify EMA alpha=0.2: new value gets 20% weight."""
        rep = ProviderReputation(provider_id="p1")
        # Start at 0.5, record success (1.0)
        # New EMA = 0.2 * 1.0 + 0.8 * 0.5 = 0.6
        rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        assert abs(rep.success_rate_ema - 0.6) < 1e-10

    def test_counters_are_accurate(self):
        rep = ProviderReputation(provider_id="p1")
        rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=100)
        rep.record_outcome(RequestOutcome.SUCCESS, latency_ms=200)
        rep.record_outcome(RequestOutcome.ERROR)
        rep.record_outcome(RequestOutcome.TIMEOUT)
        assert rep.total_requests == 4
        assert rep.total_successes == 2
        assert rep.total_failures == 1
        assert rep.total_timeouts == 1
