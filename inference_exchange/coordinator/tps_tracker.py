"""Dynamic TPS (tokens-per-second) tracking per provider per model.

Tracks actual inference speed from completed requests using exponential
moving average (EMA). Provides both:
- Initial estimates from a hardware lookup table
- Observed reality from actual request measurements

The scoring engine uses observed TPS when available (after 3+ measurements),
falling back to the hardware estimate for new providers.
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# --- Hardware lookup table (initial TPS estimates before measurement) ---
# Format: (hardware_class, model_size) → expected tok/s
# These are rough estimates — reality varies with quantization, context length, etc.

EXPECTED_TPS: dict[tuple[str, str], float] = {
    # Apple Silicon
    ("apple-m1", "0.5b"): 80,
    ("apple-m1", "3b"): 40,
    ("apple-m1", "7b"): 20,
    ("apple-m1", "8b"): 18,
    ("apple-m1", "13b"): 10,
    ("apple-m1-pro", "7b"): 35,
    ("apple-m1-pro", "8b"): 32,
    ("apple-m1-pro", "13b"): 18,
    ("apple-m1-max", "7b"): 45,
    ("apple-m1-max", "13b"): 25,
    ("apple-m1-max", "70b"): 8,
    ("apple-m2", "7b"): 30,
    ("apple-m2-pro", "7b"): 45,
    ("apple-m2-pro", "13b"): 25,
    ("apple-m2-max", "7b"): 55,
    ("apple-m2-max", "70b"): 12,
    ("apple-m2-ultra", "7b"): 70,
    ("apple-m2-ultra", "70b"): 20,
    ("apple-m3", "7b"): 35,
    ("apple-m3-pro", "7b"): 50,
    ("apple-m3-max", "7b"): 65,
    ("apple-m3-max", "70b"): 15,
    ("apple-m4", "7b"): 40,
    ("apple-m4-pro", "7b"): 60,
    ("apple-m4-pro", "13b"): 35,
    ("apple-m4-max", "7b"): 80,
    ("apple-m4-max", "70b"): 22,
    # NVIDIA
    ("nvidia-rtx3060", "7b"): 40,
    ("nvidia-rtx3070", "7b"): 55,
    ("nvidia-rtx3080", "7b"): 70,
    ("nvidia-rtx3090", "7b"): 90,
    ("nvidia-rtx3090", "13b"): 50,
    ("nvidia-rtx3090", "70b"): 12,
    ("nvidia-rtx4060", "7b"): 50,
    ("nvidia-rtx4070", "7b"): 65,
    ("nvidia-rtx4080", "7b"): 85,
    ("nvidia-rtx4090", "7b"): 130,
    ("nvidia-rtx4090", "13b"): 75,
    ("nvidia-rtx4090", "70b"): 20,
    # AMD CPU
    ("amd-ryzen-7", "7b"): 15,
    ("amd-ryzen-9", "7b"): 25,
    ("amd-epyc", "7b"): 30,
    ("amd-epyc-sev", "7b"): 28,  # ~10% overhead from SEV
    # Intel CPU
    ("intel-core-i7", "7b"): 12,
    ("intel-core-i9", "7b"): 18,
    ("intel-xeon", "7b"): 20,
    # Generic fallbacks
    ("unknown", "0.5b"): 30,
    ("unknown", "3b"): 15,
    ("unknown", "7b"): 10,
    ("unknown", "8b"): 9,
    ("unknown", "13b"): 5,
    ("unknown", "70b"): 2,
}


def estimate_initial_tps(hardware: str, model_name: str) -> float:
    """Estimate TPS from hardware class and model size.

    Uses the lookup table, falling back to progressively less specific matches.
    """
    # Try to extract model size from name
    model_size = _extract_model_size(model_name)

    # Exact match
    key = (hardware.lower(), model_size)
    if key in EXPECTED_TPS:
        return EXPECTED_TPS[key]

    # Try hardware prefix match (e.g. "apple-m4-pro-48gb" → "apple-m4-pro")
    for known_hw, known_size in EXPECTED_TPS:
        if hardware.lower().startswith(known_hw) and known_size == model_size:
            return EXPECTED_TPS[(known_hw, known_size)]

    # Fallback to unknown hardware
    key = ("unknown", model_size)
    if key in EXPECTED_TPS:
        return EXPECTED_TPS[key]

    # Final fallback
    return 10.0


def _extract_model_size(model_name: str) -> str:
    """Extract model parameter count from name (e.g. 'llama-3.1-8b-instruct' → '8b')."""
    name_lower = model_name.lower()
    for size in ["0.5b", "1b", "3b", "7b", "8b", "13b", "14b", "27b", "34b", "70b", "72b", "405b"]:
        if size in name_lower:
            return size
    # Check for size without 'b' suffix
    for size in ["0.5", "1", "3", "7", "8", "13", "14", "27", "34", "70", "72", "405"]:
        if f"-{size}-" in name_lower or f" {size} " in name_lower or name_lower.endswith(f"-{size}"):
            return f"{size}b"
    return "7b"  # Default assumption


@dataclass
class TPSMeasurement:
    """A single TPS measurement from a completed request."""

    tokens: int
    seconds: float
    tps: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class ProviderModelTPS:
    """Tracked TPS for a specific (provider, model) pair."""

    provider_id: str
    model: str
    hardware: str

    # Initial estimate from hardware table
    estimated_tps: float = 0

    # Exponential moving average of observed TPS
    observed_tps_ema: float = 0
    ema_alpha: float = 0.15  # Responsiveness: higher = more reactive to recent values

    # Measurements
    measurements: deque = field(default_factory=lambda: deque(maxlen=100))
    total_requests: int = 0
    total_tokens: int = 0

    # Anomaly detection
    min_observed: float = float("inf")
    max_observed: float = 0

    def __post_init__(self):
        if self.estimated_tps == 0:
            self.estimated_tps = estimate_initial_tps(self.hardware, self.model)

    def record(self, tokens: int, seconds: float):
        """Record a completed request's performance."""
        if seconds <= 0 or tokens <= 0:
            return

        tps = tokens / seconds
        measurement = TPSMeasurement(tokens=tokens, seconds=seconds, tps=tps)
        self.measurements.append(measurement)
        self.total_requests += 1
        self.total_tokens += tokens

        # Update EMA
        if self.observed_tps_ema == 0:
            self.observed_tps_ema = tps  # First measurement — seed the EMA
        else:
            self.observed_tps_ema = (
                self.ema_alpha * tps + (1 - self.ema_alpha) * self.observed_tps_ema
            )

        # Track min/max
        self.min_observed = min(self.min_observed, tps)
        self.max_observed = max(self.max_observed, tps)

    @property
    def effective_tps(self) -> float:
        """The TPS value to use for scoring.

        Uses observed EMA after enough measurements, else hardware estimate.
        """
        if self.total_requests >= 3:
            return self.observed_tps_ema
        elif self.total_requests > 0:
            # Blend: weight toward observed as we get more data
            weight = self.total_requests / 3.0
            return weight * self.observed_tps_ema + (1 - weight) * self.estimated_tps
        else:
            return self.estimated_tps

    @property
    def is_anomalous(self) -> bool:
        """Detect if recent performance is significantly below expected."""
        if self.total_requests < 5:
            return False
        # If latest measurement is below 50% of EMA, something is wrong
        if self.measurements:
            latest = self.measurements[-1].tps
            return latest < self.observed_tps_ema * 0.5
        return False

    def to_dict(self) -> dict:
        recent = list(self.measurements)[-10:] if self.measurements else []
        return {
            "provider_id": self.provider_id,
            "model": self.model,
            "hardware": self.hardware,
            "estimated_tps": round(self.estimated_tps, 1),
            "observed_tps_ema": round(self.observed_tps_ema, 1),
            "effective_tps": round(self.effective_tps, 1),
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "is_anomalous": self.is_anomalous,
            "recent": [{"tps": round(m.tps, 1), "tokens": m.tokens} for m in recent],
        }


class TPSTracker:
    """Tracks TPS across all providers and models."""

    def __init__(self):
        self._stats: dict[tuple[str, str], ProviderModelTPS] = {}  # (provider_id, model) → stats

    def get_or_create(self, provider_id: str, model: str, hardware: str = "unknown") -> ProviderModelTPS:
        """Get or create a TPS tracker for a (provider, model) pair."""
        key = (provider_id, model)
        if key not in self._stats:
            self._stats[key] = ProviderModelTPS(
                provider_id=provider_id,
                model=model,
                hardware=hardware,
            )
        return self._stats[key]

    def record_request(
        self, provider_id: str, model: str, tokens: int, seconds: float, hardware: str = "unknown"
    ):
        """Record a completed request's performance."""
        stats = self.get_or_create(provider_id, model, hardware)
        stats.record(tokens, seconds)

        if stats.is_anomalous:
            logger.warning(
                f"TPS anomaly: {provider_id}/{model} — "
                f"latest={stats.measurements[-1].tps:.1f}, EMA={stats.observed_tps_ema:.1f}"
            )

    def get_effective_tps(self, provider_id: str, model: str, hardware: str = "unknown") -> float:
        """Get the current effective TPS for scoring."""
        stats = self.get_or_create(provider_id, model, hardware)
        return stats.effective_tps

    def get_all_stats(self) -> list[dict]:
        """Get all tracked stats (for admin dashboard)."""
        return [s.to_dict() for s in self._stats.values()]

    def remove_provider(self, provider_id: str):
        """Remove a provider's stats (on disconnect, keep for history)."""
        # Don't actually remove — keep history. Just mark as disconnected.
        pass
