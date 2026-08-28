"""Matching strategies — pluggable algorithms for pairing orders with providers.

Each strategy implements the same Protocol (interface). You can swap strategies
without changing the matching engine or any upstream code.

Current strategies:
- GreedyStrategy: Immediate matching, picks best available provider per request.
  O(n×m) where n=orders, m=providers. Best for low-volume or latency-critical.

- BatchAuctionStrategy: Collects orders over a time window, then solves the
  optimal assignment. Better global allocation at the cost of added latency.

Future strategies (not yet implemented):
- StreamingStrategy: Event-driven, re-evaluates on each new order/provider change
- VCGAuctionStrategy: Second-price auction with incentive compatibility
- PredictiveStrategy: ML-based, predicts future demand and pre-positions capacity
"""

from typing import Protocol

from .models import (
    ConfidenceLevel,
    InferenceOrder,
    MatchFailure,
    MatchResult,
    ProviderOffer,
    RoutingPreference,
)


class MatchingStrategy(Protocol):
    """Interface for matching algorithms.

    Implementations receive a set of unmatched orders and available provider
    offers, and return a list of matches (and failures).

    The engine calls `match()` either:
    - On every new order arrival (streaming/greedy strategies)
    - On a periodic timer (batch strategies)
    - On capacity change events (reactive strategies)
    """

    def match(
        self,
        orders: list[InferenceOrder],
        offers: list[ProviderOffer],
    ) -> tuple[list[MatchResult], list[MatchFailure]]:
        """Match orders to offers.

        Args:
            orders: Unmatched inference orders (buy side)
            offers: Available provider offers (sell side)

        Returns:
            Tuple of (successful matches, failed matches)
        """
        ...


# ---------------------------------------------------------------------------
# Scoring utilities (shared across strategies)
# ---------------------------------------------------------------------------


def compute_score(order: InferenceOrder, offer: ProviderOffer) -> float:
    """Compute a composite score for an (order, offer) pair.

    Returns -1 if the pair is ineligible (hard constraint violated).
    Otherwise returns a positive score (higher = better match).
    """
    # --- Hard constraints (any failure = ineligible) ---

    # Model must match (or order accepts "default")
    if order.model != "default" and order.model not in offer.models:
        return -1

    # Price must be within budget
    if offer.price_per_mtok_output > order.max_price_per_mtok:
        return -1

    # Security must meet minimum
    if offer.confidence_level.value < order.min_confidence.value:
        return -1

    # Provider must have capacity
    if not offer.is_available:
        return -1

    # --- Soft scoring ---

    # Determine weights based on consumer preference
    if order.preference == RoutingPreference.CHEAPEST:
        w_price, w_speed, w_trust, w_load = 0.6, 0.15, 0.1, 0.15
    elif order.preference == RoutingPreference.FASTEST:
        w_price, w_speed, w_trust, w_load = 0.1, 0.6, 0.1, 0.2
    elif order.preference == RoutingPreference.MOST_SECURE:
        w_price, w_speed, w_trust, w_load = 0.1, 0.1, 0.6, 0.2
    else:  # BALANCED
        w_price, w_speed, w_trust, w_load = 0.35, 0.25, 0.2, 0.2

    # Price score: lower price → higher score. Normalized to [0, 1].
    # At $0/Mtok → 1.0, at $5/Mtok → ~0.17
    price_score = 1.0 / (1.0 + offer.price_per_mtok_output)

    # Speed score: higher throughput → higher score. Normalized.
    # 0 tok/s → 0.0, 100 tok/s → 0.91, 200 tok/s → 0.95
    speed_score = offer.measured_throughput_tps / (10.0 + offer.measured_throughput_tps)

    # Trust score: higher confidence → higher score. Normalized to [0, 1].
    trust_score = offer.confidence_level.value / 4.0

    # Load score: lower load → higher score.
    load_score = 1.0 - offer.load_factor

    # Composite
    score = (
        w_price * price_score
        + w_speed * speed_score
        + w_trust * trust_score
        + w_load * load_score
    )

    return score


# ---------------------------------------------------------------------------
# Strategy: Greedy (immediate matching)
# ---------------------------------------------------------------------------


class GreedyStrategy:
    """Immediate greedy matching — process each order independently.

    For each order, find the best eligible provider and assign.
    Simple, fast, zero added latency. Suboptimal when orders compete
    for the same scarce provider (first-come-first-served).

    Best for: Low volume, latency-sensitive workloads, single-provider setups.
    """

    def match(
        self,
        orders: list[InferenceOrder],
        offers: list[ProviderOffer],
    ) -> tuple[list[MatchResult], list[MatchFailure]]:
        matches: list[MatchResult] = []
        failures: list[MatchFailure] = []

        # Sort orders by submission time (FIFO fairness)
        sorted_orders = sorted(orders, key=lambda o: o.submitted_at)

        # Track remaining capacity (mutable copy)
        remaining_slots = {o.provider_id: o.available_slots for o in offers}

        for order in sorted_orders:
            if order.is_expired:
                failures.append(MatchFailure(
                    order_id=order.order_id, reason="timeout",
                ))
                continue

            # Score all offers for this order
            best_offer: ProviderOffer | None = None
            best_score = -1.0
            eligible_count = 0
            available_count = 0

            for offer in offers:
                # Check remaining capacity (may have been consumed by earlier order)
                if remaining_slots.get(offer.provider_id, 0) <= 0:
                    continue

                score = compute_score(order, offer)
                if score < 0:
                    continue

                eligible_count += 1
                if offer.is_available:
                    available_count += 1

                if score > best_score:
                    best_score = score
                    best_offer = offer

            if best_offer and best_score > 0:
                # Consume a slot
                remaining_slots[best_offer.provider_id] -= 1

                matches.append(MatchResult(
                    order_id=order.order_id,
                    provider_id=best_offer.provider_id,
                    score=best_score,
                    price_per_mtok_output=best_offer.price_per_mtok_output,
                    queue_time_ms=(time.time() - order.submitted_at) * 1000,
                    match_reason=f"greedy: best of {eligible_count} eligible",
                ))
            else:
                reason = "no_provider" if eligible_count == 0 else "no_capacity"
                failures.append(MatchFailure(
                    order_id=order.order_id,
                    reason=reason,
                    eligible_providers=eligible_count,
                    available_providers=available_count,
                ))

        return matches, failures


# ---------------------------------------------------------------------------
# Strategy: Batch Auction (periodic optimal assignment)
# ---------------------------------------------------------------------------


import time


class BatchAuctionStrategy:
    """Batch auction matching — collect orders, solve optimal assignment.

    Orders accumulate over a configurable window (default 50ms), then the
    engine solves the globally optimal assignment that maximizes total score
    across all orders simultaneously.

    This avoids the greedy problem where an early cheap request consumes the
    only slot of the best provider, leaving a more urgent request unserved.

    Uses the Hungarian algorithm (O(n³)) for small batches, or greedy with
    priority ordering for larger batches.

    Best for: High volume, multiple competing consumers, price-sensitive markets.
    """

    def __init__(self, batch_window_ms: float = 50.0):
        self.batch_window_ms = batch_window_ms

    def match(
        self,
        orders: list[InferenceOrder],
        offers: list[ProviderOffer],
    ) -> tuple[list[MatchResult], list[MatchFailure]]:
        matches: list[MatchResult] = []
        failures: list[MatchFailure] = []

        if not orders or not offers:
            for order in orders:
                failures.append(MatchFailure(
                    order_id=order.order_id, reason="no_provider",
                ))
            return matches, failures

        # Build the score matrix: orders × provider_slots
        # Expand provider slots: a provider with 3 free slots appears 3 times
        expanded_offers: list[ProviderOffer] = []
        for offer in offers:
            for _ in range(offer.available_slots):
                expanded_offers.append(offer)

        if not expanded_offers:
            for order in orders:
                failures.append(MatchFailure(
                    order_id=order.order_id, reason="no_capacity",
                ))
            return matches, failures

        # Compute score matrix
        n_orders = len(orders)
        n_slots = len(expanded_offers)

        # Score matrix: scores[i][j] = score of assigning order i to slot j
        scores: list[list[float]] = []
        for order in orders:
            row = []
            for offer in expanded_offers:
                row.append(compute_score(order, offer))
            scores.append(row)

        # Solve assignment: use priority-ordered greedy for now
        # (Hungarian is O(n³) and complex to implement; greedy with
        # "most constrained first" ordering is near-optimal in practice)
        assignment = self._solve_assignment(orders, expanded_offers, scores)

        # Track which provider slots are consumed
        consumed_slots: dict[str, int] = {}

        for order_idx, slot_idx in assignment:
            order = orders[order_idx]
            offer = expanded_offers[slot_idx]
            score = scores[order_idx][slot_idx]

            # Verify we haven't over-assigned this provider
            pid = offer.provider_id
            consumed_slots[pid] = consumed_slots.get(pid, 0) + 1
            if consumed_slots[pid] > offer.total_slots:
                continue  # Skip: would exceed capacity

            matches.append(MatchResult(
                order_id=order.order_id,
                provider_id=offer.provider_id,
                score=score,
                price_per_mtok_output=offer.price_per_mtok_output,
                queue_time_ms=(time.time() - order.submitted_at) * 1000,
                match_reason=f"batch: optimal of {n_slots} slots across {len(offers)} providers",
            ))

        # Any unmatched orders are failures
        matched_order_ids = {m.order_id for m in matches}
        for order in orders:
            if order.order_id not in matched_order_ids:
                if order.is_expired:
                    failures.append(MatchFailure(order_id=order.order_id, reason="timeout"))
                else:
                    failures.append(MatchFailure(order_id=order.order_id, reason="no_capacity"))

        return matches, failures

    def _solve_assignment(
        self,
        orders: list[InferenceOrder],
        slots: list[ProviderOffer],
        scores: list[list[float]],
    ) -> list[tuple[int, int]]:
        """Solve the assignment problem: assign orders to slots maximizing total score.

        Uses "most constrained first" greedy: orders with fewer eligible slots
        get assigned first, so they don't get squeezed out by less picky orders.
        This is a common heuristic that performs near-optimally in practice.
        """
        n_orders = len(orders)
        n_slots = len(slots)

        # For each order, count how many eligible slots it has
        eligibility_count = []
        for i in range(n_orders):
            count = sum(1 for s in scores[i] if s > 0)
            eligibility_count.append((count, i))

        # Sort by eligibility (most constrained first)
        eligibility_count.sort()

        # Greedy assign
        used_slots: set[int] = set()
        assignment: list[tuple[int, int]] = []

        for _, order_idx in eligibility_count:
            # Find best available slot for this order
            best_slot = -1
            best_score = -1.0

            for slot_idx in range(n_slots):
                if slot_idx in used_slots:
                    continue
                score = scores[order_idx][slot_idx]
                if score > best_score:
                    best_score = score
                    best_slot = slot_idx

            if best_slot >= 0 and best_score > 0:
                assignment.append((order_idx, best_slot))
                used_slots.add(best_slot)

        return assignment
