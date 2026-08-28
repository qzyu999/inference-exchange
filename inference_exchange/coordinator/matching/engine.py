"""Matching Engine — orchestrates order collection, strategy execution, and dispatch.

The engine is the coordinator's core decision-maker. It:
1. Accepts incoming inference orders (from consumer API)
2. Maintains the current provider offer book (from provider hub)
3. Periodically (or immediately) runs the matching strategy
4. Returns match results for dispatch

The engine is decoupled from transport (WebSocket/HTTP) — it operates on
abstract InferenceOrder and ProviderOffer objects.
"""

import asyncio
import logging
import time
from collections.abc import Callable

from .models import ConfidenceLevel, InferenceOrder, MatchFailure, MatchResult, ProviderOffer
from .strategy import BatchAuctionStrategy, GreedyStrategy, MatchingStrategy

logger = logging.getLogger(__name__)


class MatchingEngine:
    """Orchestrates order matching with a pluggable strategy.

    Two operational modes:

    1. IMMEDIATE mode (GreedyStrategy): match() is called synchronously on each
       new order. Zero added latency, suboptimal under contention.

    2. BATCH mode (BatchAuctionStrategy): orders accumulate, a background task
       runs the strategy every `batch_interval_ms` milliseconds. Adds latency
       but produces globally better assignments.

    Switch strategies at runtime via `set_strategy()`.
    """

    def __init__(
        self,
        strategy: MatchingStrategy | None = None,
        batch_interval_ms: float = 50.0,
        on_match: Callable[[MatchResult], None] | None = None,
        on_failure: Callable[[MatchFailure], None] | None = None,
    ):
        self._strategy = strategy or GreedyStrategy()
        self._batch_interval_ms = batch_interval_ms

        # Callbacks for dispatching results
        self._on_match = on_match
        self._on_failure = on_failure

        # Order book
        self._pending_orders: list[InferenceOrder] = []
        self._offers: list[ProviderOffer] = []

        # Stats
        self.total_orders = 0
        self.total_matches = 0
        self.total_failures = 0
        self.total_match_cycles = 0
        self._avg_match_time_ms = 0.0

        # Background task (for batch mode)
        self._batch_task: asyncio.Task | None = None

    @property
    def strategy_name(self) -> str:
        return type(self._strategy).__name__

    @property
    def pending_orders(self) -> int:
        return len(self._pending_orders)

    @property
    def avg_match_time_ms(self) -> float:
        return self._avg_match_time_ms

    def set_strategy(self, strategy: MatchingStrategy):
        """Swap matching strategy at runtime."""
        old_name = self.strategy_name
        self._strategy = strategy
        logger.info(f"Matching strategy changed: {old_name} → {self.strategy_name}")

    def update_offers(self, offers: list[ProviderOffer]):
        """Update the current provider offer book (called on heartbeat/connect/disconnect)."""
        self._offers = offers

    def submit_order(self, order: InferenceOrder) -> MatchResult | None:
        """Submit an order for matching.

        In IMMEDIATE mode (GreedyStrategy): attempts to match now and returns result.
        In BATCH mode: queues the order and returns None (result delivered via callback).
        """
        self.total_orders += 1

        if isinstance(self._strategy, GreedyStrategy):
            # Immediate: try to match right now
            matches, failures = self._strategy.match([order], self._offers)

            if matches:
                match = matches[0]
                self.total_matches += 1
                self.total_match_cycles += 1
                if self._on_match:
                    self._on_match(match)
                return match
            elif failures:
                self.total_failures += 1
                if self._on_failure:
                    self._on_failure(failures[0])
                return None
            return None
        else:
            # Batch: queue for next cycle
            self._pending_orders.append(order)
            return None

    def run_batch_cycle(self) -> tuple[list[MatchResult], list[MatchFailure]]:
        """Manually trigger a batch matching cycle. Returns results.

        Useful for testing or when you want explicit control over timing.
        """
        if not self._pending_orders:
            return [], []

        # Remove expired orders
        now = time.time()
        expired = [o for o in self._pending_orders if o.is_expired]
        self._pending_orders = [o for o in self._pending_orders if not o.is_expired]

        expired_failures = [
            MatchFailure(order_id=o.order_id, reason="timeout")
            for o in expired
        ]

        # Run strategy
        start = time.time()
        matches, failures = self._strategy.match(self._pending_orders, self._offers)
        elapsed_ms = (time.time() - start) * 1000

        # Update stats
        self.total_match_cycles += 1
        self.total_matches += len(matches)
        self.total_failures += len(failures) + len(expired_failures)
        self._avg_match_time_ms = (
            self._avg_match_time_ms * 0.9 + elapsed_ms * 0.1
        )

        # Remove matched orders from pending
        matched_ids = {m.order_id for m in matches}
        failed_ids = {f.order_id for f in failures}
        self._pending_orders = [
            o for o in self._pending_orders
            if o.order_id not in matched_ids and o.order_id not in failed_ids
        ]

        # Deliver callbacks
        for match in matches:
            if self._on_match:
                self._on_match(match)
        for failure in failures + expired_failures:
            if self._on_failure:
                self._on_failure(failure)

        if matches or failures:
            logger.info(
                f"Batch cycle: {len(matches)} matched, {len(failures)} failed, "
                f"{len(self._pending_orders)} still pending ({elapsed_ms:.1f}ms)"
            )

        return matches, failures + expired_failures

    async def start_batch_loop(self):
        """Start the background batch matching loop (for batch strategies)."""
        if self._batch_task is not None:
            return

        async def _loop():
            interval = self._batch_interval_ms / 1000.0
            while True:
                await asyncio.sleep(interval)
                if self._pending_orders:
                    self.run_batch_cycle()

        self._batch_task = asyncio.create_task(_loop())
        logger.info(
            f"Batch matching loop started: {self._batch_interval_ms}ms interval, "
            f"strategy={self.strategy_name}"
        )

    async def stop_batch_loop(self):
        """Stop the background batch loop."""
        if self._batch_task:
            self._batch_task.cancel()
            self._batch_task = None

    def stats(self) -> dict:
        """Engine statistics."""
        return {
            "strategy": self.strategy_name,
            "total_orders": self.total_orders,
            "total_matches": self.total_matches,
            "total_failures": self.total_failures,
            "match_rate": (
                self.total_matches / self.total_orders if self.total_orders > 0 else 0
            ),
            "pending_orders": self.pending_orders,
            "available_offers": len(self._offers),
            "avg_match_time_ms": round(self._avg_match_time_ms, 2),
            "total_cycles": self.total_match_cycles,
        }
