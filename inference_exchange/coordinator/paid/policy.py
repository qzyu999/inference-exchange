"""Routing policy: which offers may serve an order, and in what order (design §4 rule 1).

`eligible` applies every hard constraint and names the reason for each
rejection (ROUTE-010). `rank` orders what is left, with a stable tie-break.
The hub's immediate, queued and retry paths all call these two functions.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import Candidate, Order

# Preference -> weights for (price, speed, trust, load). Unchanged from the
# matching strategy, so routing behaviour does not change in this slice.
WEIGHTS = {
    "cheapest": (0.6, 0.15, 0.1, 0.15),
    "fastest": (0.1, 0.6, 0.1, 0.2),
    "most_secure": (0.1, 0.1, 0.6, 0.2),
    "balanced": (0.35, 0.25, 0.2, 0.2),
}
AFFINITY_BONUS = 1.2


@dataclass(frozen=True)
class Eligibility:
    eligible: list[Candidate]
    rejected: dict[str, str]


def _rejection(order: Order, c: Candidate) -> str | None:
    if c.provider_id in order.exclude:
        return "already_tried"
    if c.supply == "vendor" and not order.hosted_consent:
        return "hosted_not_consented"  # ROUTE-009, D4
    if order.model != "default" and order.model not in c.models:
        return "model_not_served"
    if order.max_price is not None and c.price_output > order.max_price:
        return "above_price_ceiling"
    if c.trust < order.min_trust:
        return "below_min_trust"  # P1: never downgrade
    if c.free <= 0:
        return "no_capacity"
    return None


def eligible(order: Order, offers: list[Candidate]) -> Eligibility:
    ok, rejected = [], {}
    for c in offers:
        reason = _rejection(order, c)
        if reason is None:
            ok.append(c)
        else:
            rejected[c.provider_id] = reason
    return Eligibility(ok, rejected)


def score(order: Order, c: Candidate) -> float:
    w_price, w_speed, w_trust, w_load = WEIGHTS.get(order.preference, WEIGHTS["balanced"])
    load = 1.0 if c.slots == 0 else c.used / c.slots
    s = (w_price / (1.0 + c.price_output)
         + w_speed * c.tps / (10.0 + c.tps)
         + w_trust * c.trust / 4.0
         + w_load * (1.0 - load))
    s *= 0.5 + 0.5 * c.reputation
    if order.affinity and order.affinity == c.provider_id:
        s *= AFFINITY_BONUS
    return s


def rank(order: Order, candidates: list[Candidate]) -> list[Candidate]:
    """Best first. Equal scores order by provider ID, so the result is deterministic."""
    return sorted(candidates, key=lambda c: (-score(order, c), c.provider_id))


def choose(order: Order, offers: list[Candidate]) -> Candidate | None:
    ranked = rank(order, eligible(order, offers).eligible)
    return ranked[0] if ranked else None
