"""Provider reputation — tracks reliability and factors it into routing.

Every completed request updates the provider's reputation score.
Providers with high failure rates, timeouts, or slow performance
get naturally deprioritized by the matching engine.

Reputation is an exponential moving average (EMA) of recent outcomes,
so a provider can recover from a bad streak.
"""

import logging
import time
from dataclasses import dataclass, field
from collections import deque
from enum import Enum

logger = logging.getLogger(__name__)


class RequestOutcome(str, Enum):
    SUCCESS = "success"
    ERROR = "error"  # Provider returned an error
    TIMEOUT = "timeout"  # Provider didn't respond in time
    DISCONNECT = "disconnect"  # Provider disconnected mid-request


@dataclass
class OutcomeRecord:
    outcome: RequestOutcome
    tokens: int = 0
    latency_ms: int = 0
    timestamp: float = field(default_factory=time.time)


@dataclass
class ProviderReputation:
    """Reputation state for a single provider."""

    provider_id: str

    # EMA scores (0.0 = terrible, 1.0 = perfect)
    success_rate_ema: float = 0.5  # Start neutral
    latency_score_ema: float = 0.5  # Start neutral

    # Raw counters
    total_requests: int = 0
    total_successes: int = 0
    total_failures: int = 0
    total_timeouts: int = 0

    # Recent history (for display/debugging)
    recent_outcomes: deque = field(default_factory=lambda: deque(maxlen=50))

    # Computed score (used by matching engine)
    @property
    def score(self) -> float:
        """Composite reputation score [0, 1]. Higher = more trustworthy."""
        if self.total_requests < 3:
            return 0.5  # Neutral for new providers

        # Weight: 70% success rate, 30% latency
        return 0.7 * self.success_rate_ema + 0.3 * self.latency_score_ema

    @property
    def is_degraded(self) -> bool:
        """True if provider is performing badly enough to deprioritize."""
        return self.total_requests >= 5 and self.success_rate_ema < 0.5

    def record_outcome(self, outcome: RequestOutcome, tokens: int = 0, latency_ms: int = 0):
        """Record the outcome of a request."""
        self.total_requests += 1
        record = OutcomeRecord(outcome=outcome, tokens=tokens, latency_ms=latency_ms)
        self.recent_outcomes.append(record)

        # EMA alpha (how quickly we respond to changes)
        alpha = 0.2

        if outcome == RequestOutcome.SUCCESS:
            self.total_successes += 1
            self.success_rate_ema = alpha * 1.0 + (1 - alpha) * self.success_rate_ema

            # Latency score: fast = good. Score based on TTFT-like latency.
            # < 500ms = great (1.0), > 5000ms = poor (0.0)
            latency_norm = max(0, 1.0 - (latency_ms / 5000))
            self.latency_score_ema = alpha * latency_norm + (1 - alpha) * self.latency_score_ema

        elif outcome == RequestOutcome.ERROR:
            self.total_failures += 1
            self.success_rate_ema = alpha * 0.0 + (1 - alpha) * self.success_rate_ema

        elif outcome == RequestOutcome.TIMEOUT:
            self.total_timeouts += 1
            self.success_rate_ema = alpha * 0.0 + (1 - alpha) * self.success_rate_ema
            self.latency_score_ema = alpha * 0.0 + (1 - alpha) * self.latency_score_ema

        elif outcome == RequestOutcome.DISCONNECT:
            self.total_failures += 1
            self.success_rate_ema = alpha * 0.0 + (1 - alpha) * self.success_rate_ema

    def to_dict(self) -> dict:
        return {
            "provider_id": self.provider_id,
            "score": round(self.score, 3),
            "success_rate_ema": round(self.success_rate_ema, 3),
            "latency_score_ema": round(self.latency_score_ema, 3),
            "total_requests": self.total_requests,
            "total_successes": self.total_successes,
            "total_failures": self.total_failures,
            "total_timeouts": self.total_timeouts,
            "is_degraded": self.is_degraded,
            "recent": [
                {"outcome": r.outcome.value, "tokens": r.tokens, "latency_ms": r.latency_ms}
                for r in list(self.recent_outcomes)[-10:]
            ],
        }


class ReputationTracker:
    """Tracks reputation for all providers."""

    def __init__(self):
        self._reputations: dict[str, ProviderReputation] = {}

    def get_or_create(self, provider_id: str) -> ProviderReputation:
        if provider_id not in self._reputations:
            self._reputations[provider_id] = ProviderReputation(provider_id=provider_id)
        return self._reputations[provider_id]

    def record_success(self, provider_id: str, tokens: int = 0, latency_ms: int = 0):
        rep = self.get_or_create(provider_id)
        rep.record_outcome(RequestOutcome.SUCCESS, tokens=tokens, latency_ms=latency_ms)

    def record_error(self, provider_id: str):
        rep = self.get_or_create(provider_id)
        rep.record_outcome(RequestOutcome.ERROR)

    def record_timeout(self, provider_id: str):
        rep = self.get_or_create(provider_id)
        rep.record_outcome(RequestOutcome.TIMEOUT)

    def record_disconnect(self, provider_id: str):
        rep = self.get_or_create(provider_id)
        rep.record_outcome(RequestOutcome.DISCONNECT)

    def get_score(self, provider_id: str) -> float:
        """Get reputation score [0, 1] for scoring/routing."""
        rep = self.get_or_create(provider_id)
        return rep.score

    def is_degraded(self, provider_id: str) -> bool:
        """Check if provider is performing too poorly."""
        rep = self.get_or_create(provider_id)
        return rep.is_degraded

    def get_all_stats(self) -> list[dict]:
        return [r.to_dict() for r in self._reputations.values()]
