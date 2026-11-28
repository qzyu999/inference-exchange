"""Value types for the paid path. Frozen, so a pure function cannot change its input."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rates:
    """USD per million tokens, as decimal strings (BILL-013: six decimal places)."""
    input: str
    output: str
    cache: str = "0"


@dataclass(frozen=True)
class Candidate:
    """One routable offer, from a provider or a vendor (decision 0011)."""
    provider_id: str
    models: frozenset[str]
    price_output: float
    trust: int  # 0 open, 1 contained, 2 hardened, 3 confidential
    slots: int
    used: int = 0
    tps: float = 0.0
    reputation: float = 1.0
    supply: str = "provider"  # "provider" (IE agent) or "vendor" (hosted API)

    @property
    def free(self) -> int:
        return max(0, self.slots - self.used)


@dataclass(frozen=True)
class Order:
    """What the customer asked for. Hard constraints filter; preference ranks."""
    model: str
    min_trust: int = 0
    max_price: float | None = None
    preference: str = "balanced"
    exclude: frozenset[str] = field(default_factory=frozenset)
    affinity: str = ""
    hosted_consent: bool = False


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int = 0


@dataclass(frozen=True)
class Charge:
    """What to debit. `excess` is reported cost above the hold that IE absorbs (D6)."""
    amount: int
    excess: int = 0
