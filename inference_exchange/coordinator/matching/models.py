"""Data models for the matching engine.

These are the formal types that represent the "order book" of inference requests
and provider capacity. They're deliberately decoupled from the WebSocket/HTTP layer
so the matching logic can be tested and reasoned about independently.
"""

import time
from dataclasses import dataclass, field
from enum import Enum


class RoutingPreference(str, Enum):
    """How the consumer wants their request routed."""

    CHEAPEST = "cheapest"  # Minimize cost
    FASTEST = "fastest"  # Minimize latency / maximize throughput
    MOST_SECURE = "most_secure"  # Maximize confidence level
    BALANCED = "balanced"  # Default: weighted combination


class ConfidenceLevel(int, Enum):
    """Numeric confidence levels for comparison."""

    OPEN = 0
    CONTAINED = 1
    HARDENED = 2
    CONFIDENTIAL = 3
    FULLY_CONFIDENTIAL = 4


@dataclass
class InferenceOrder:
    """A consumer's request for inference — the 'buy' side of the exchange.

    This represents what the consumer wants and is willing to pay for.
    Hard constraints MUST be satisfied; soft preferences influence ranking.
    """

    # Identity
    order_id: str  # Unique request ID
    consumer_id: str

    # Hard constraints (must be satisfied or no match)
    model: str  # Required model (or "default" = any)
    max_price_per_mtok: float = float("inf")  # Max acceptable $/Mtok output
    min_confidence: ConfidenceLevel = ConfidenceLevel.OPEN

    # Soft preferences (influence scoring, not eligibility)
    preference: RoutingPreference = RoutingPreference.BALANCED
    min_throughput_tps: float = 0  # Preferred minimum tok/s (soft)

    # Metadata
    estimated_tokens: int = 100  # Estimated output tokens (for capacity planning)
    submitted_at: float = field(default_factory=time.time)
    timeout_seconds: float = 120.0  # Max time in queue before 503

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.submitted_at) > self.timeout_seconds


@dataclass
class ProviderOffer:
    """A provider's standing offer to serve inference — the 'sell' side.

    This represents current provider capacity. It's updated on every heartbeat
    and when requests are assigned/completed.
    """

    # Identity
    provider_id: str
    provider_name: str

    # What they offer
    models: list[str]
    price_per_mtok_input: float
    price_per_mtok_output: float
    confidence_level: ConfidenceLevel
    measured_throughput_tps: float  # Observed tokens/sec

    # Current state
    total_slots: int  # max_concurrent
    used_slots: int = 0  # Currently in-flight requests
    encrypted: bool = False  # Supports E2E encryption

    # Hardware context (for scoring)
    hardware: str = "unknown"
    memory_gb: float = 0

    @property
    def available_slots(self) -> int:
        return max(0, self.total_slots - self.used_slots)

    @property
    def load_factor(self) -> float:
        """0.0 = idle, 1.0 = full."""
        if self.total_slots == 0:
            return 1.0
        return self.used_slots / self.total_slots

    @property
    def is_available(self) -> bool:
        return self.available_slots > 0


@dataclass
class MatchResult:
    """The outcome of a matching decision."""

    order_id: str
    provider_id: str
    score: float  # The composite score that determined this match
    price_per_mtok_output: float  # The price the consumer will pay
    match_reason: str = ""  # Human-readable explanation

    # Timing
    matched_at: float = field(default_factory=time.time)
    queue_time_ms: float = 0  # How long the order waited


@dataclass
class MatchFailure:
    """Why a match failed."""

    order_id: str
    reason: str  # "no_provider", "no_capacity", "price_exceeded", "timeout"
    eligible_providers: int = 0  # How many providers could serve this model
    available_providers: int = 0  # How many had free capacity
