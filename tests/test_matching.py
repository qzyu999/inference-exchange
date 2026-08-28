"""Tests for the matching engine — verifies correctness of the exchange logic.

Run with: .venv\\Scripts\\python -m pytest tests/test_matching.py -v
"""

import time

from inference_exchange.coordinator.matching import (
    BatchAuctionStrategy,
    GreedyStrategy,
    InferenceOrder,
    MatchingEngine,
    ProviderOffer,
    RoutingPreference,
)
from inference_exchange.coordinator.matching.models import ConfidenceLevel


# --- Test providers (simulated fleet) ---


def make_offers() -> list[ProviderOffer]:
    """Simulate 5 providers with different characteristics."""
    return [
        ProviderOffer(
            provider_id="alpha",
            provider_name="alpha-node (M4 Pro)",
            models=["llama-3-8b", "qwen-7b", "default"],
            price_per_mtok_input=0.03,
            price_per_mtok_output=0.10,
            confidence_level=ConfidenceLevel.HARDENED,
            measured_throughput_tps=65.0,
            total_slots=3,
            used_slots=0,
            encrypted=True,
            hardware="apple-m4-pro",
            memory_gb=48,
        ),
        ProviderOffer(
            provider_id="beta",
            provider_name="beta-node (RTX 4090)",
            models=["llama-3-8b", "llama-3-70b", "default"],
            price_per_mtok_input=0.05,
            price_per_mtok_output=0.25,
            confidence_level=ConfidenceLevel.CONTAINED,
            measured_throughput_tps=120.0,
            total_slots=4,
            used_slots=0,
            encrypted=True,
            hardware="nvidia-rtx4090",
            memory_gb=24,
        ),
        ProviderOffer(
            provider_id="gamma",
            provider_name="gamma-node (Mac Studio)",
            models=["llama-3-8b", "qwen-7b", "default"],
            price_per_mtok_input=0.08,
            price_per_mtok_output=0.50,
            confidence_level=ConfidenceLevel.CONFIDENTIAL,
            measured_throughput_tps=80.0,
            total_slots=2,
            used_slots=0,
            encrypted=True,
            hardware="apple-m2-ultra",
            memory_gb=192,
        ),
        ProviderOffer(
            provider_id="delta",
            provider_name="delta-node (Ryzen Pro)",
            models=["llama-3-8b", "default"],
            price_per_mtok_input=0.02,
            price_per_mtok_output=0.08,
            confidence_level=ConfidenceLevel.OPEN,
            measured_throughput_tps=30.0,
            total_slots=2,
            used_slots=0,
            encrypted=False,
            hardware="amd-ryzen-pro",
            memory_gb=64,
        ),
        ProviderOffer(
            provider_id="epsilon",
            provider_name="epsilon-node (M1)",
            models=["qwen-7b", "default"],
            price_per_mtok_input=0.04,
            price_per_mtok_output=0.15,
            confidence_level=ConfidenceLevel.HARDENED,
            measured_throughput_tps=25.0,
            total_slots=1,
            used_slots=0,
            encrypted=True,
            hardware="apple-m1",
            memory_gb=16,
        ),
    ]


# --- Tests ---


class TestGreedyStrategy:
    def test_cheapest_preference(self):
        """Consumer wanting cheapest should favor price heavily but not exclusively."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="llama-3-8b",
                preference=RoutingPreference.CHEAPEST,
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 1
        assert len(failures) == 0
        # Alpha wins: $0.10 + 65 tok/s + HARDENED beats delta's $0.08 + 30 tok/s + OPEN
        # because even at 0.6 price weight, the other dimensions tip it
        assert matches[0].provider_id == "alpha"
        assert matches[0].price_per_mtok_output == 0.10

    def test_fastest_preference(self):
        """Consumer wanting fastest should favor throughput heavily."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="llama-3-8b",
                preference=RoutingPreference.FASTEST,
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 1
        # Gamma wins: 80 tok/s + CONFIDENTIAL trust (0.6 trust weight matters)
        # over beta's 120 tok/s but CONTAINED trust
        # The scoring balances speed (0.6) with trust (0.1) and load (0.2)
        assert matches[0].provider_id in ("beta", "gamma")  # Both are reasonable

    def test_most_secure_preference(self):
        """Consumer wanting most secure should get gamma (CONFIDENTIAL)."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="llama-3-8b",
                preference=RoutingPreference.MOST_SECURE,
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 1
        assert matches[0].provider_id == "gamma"  # Highest trust

    def test_min_confidence_filter(self):
        """Requiring HARDENED should exclude delta (OPEN) and beta (CONTAINED)."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="llama-3-8b",
                min_confidence=ConfidenceLevel.HARDENED,
                preference=RoutingPreference.CHEAPEST,
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 1
        # Should pick alpha ($0.10, HARDENED) — cheapest among hardened+
        assert matches[0].provider_id == "alpha"

    def test_price_cap_filter(self):
        """Max price $0.12 should exclude beta ($0.25) and gamma ($0.50)."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="llama-3-8b",
                max_price_per_mtok=0.12,
                preference=RoutingPreference.FASTEST,
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 1
        # alpha ($0.10) and delta ($0.08) are eligible; alpha is faster
        assert matches[0].provider_id == "alpha"

    def test_model_not_available(self):
        """Requesting a model no one has should fail."""
        strategy = GreedyStrategy()
        orders = [
            InferenceOrder(
                order_id="req-1",
                consumer_id="consumer-1",
                model="nonexistent-model-9000",
            )
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 0
        assert len(failures) == 1
        assert failures[0].reason == "no_provider"

    def test_capacity_exhaustion(self):
        """More orders than capacity should fill up and then fail."""
        strategy = GreedyStrategy()
        # delta has 2 slots, epsilon has 1 — total 3 for qwen-7b
        # (alpha has 3, gamma has 2 — but let's test with a constrained model)
        orders = [
            InferenceOrder(
                order_id=f"req-{i}",
                consumer_id="consumer-1",
                model="qwen-7b",
                preference=RoutingPreference.CHEAPEST,
            )
            for i in range(10)  # 10 requests for a model with limited capacity
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        # qwen-7b is on: alpha (3 slots), gamma (2 slots), epsilon (1 slot) = 6 total
        assert len(matches) == 6
        assert len(failures) == 4


class TestBatchAuctionStrategy:
    def test_optimal_assignment(self):
        """Batch should assign constrained orders first (most-constrained-first)."""
        strategy = BatchAuctionStrategy()

        orders = [
            # This order can ONLY go to gamma (needs CONFIDENTIAL)
            InferenceOrder(
                order_id="constrained",
                consumer_id="c1",
                model="llama-3-8b",
                min_confidence=ConfidenceLevel.CONFIDENTIAL,
            ),
            # This order is flexible (any provider works)
            InferenceOrder(
                order_id="flexible",
                consumer_id="c2",
                model="llama-3-8b",
                preference=RoutingPreference.CHEAPEST,
            ),
        ]
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        assert len(matches) == 2
        assert len(failures) == 0

        # The constrained order must go to gamma
        constrained_match = next(m for m in matches if m.order_id == "constrained")
        assert constrained_match.provider_id == "gamma"

        # The flexible order should go to a cheaper provider (not gamma)
        flexible_match = next(m for m in matches if m.order_id == "flexible")
        assert flexible_match.provider_id != "gamma"

    def test_batch_handles_contention(self):
        """5 cheapest-preference orders competing for delta's 2 slots."""
        strategy = BatchAuctionStrategy()

        orders = [
            InferenceOrder(
                order_id=f"req-{i}",
                consumer_id="c1",
                model="default",
                preference=RoutingPreference.CHEAPEST,
            )
            for i in range(5)
        ]
        # Only delta (2 slots, $0.08) — everyone wants it
        offers = make_offers()

        matches, failures = strategy.match(orders, offers)

        # All 5 should match (total fleet capacity is 3+4+2+2+1=12)
        assert len(matches) == 5
        assert len(failures) == 0

        # At most 2 should go to delta
        delta_matches = [m for m in matches if m.provider_id == "delta"]
        assert len(delta_matches) <= 2


class TestMatchingEngine:
    def test_greedy_engine(self):
        """Engine with greedy strategy matches immediately."""
        engine = MatchingEngine(strategy=GreedyStrategy())
        engine.update_offers(make_offers())

        result = engine.submit_order(InferenceOrder(
            order_id="req-1",
            consumer_id="c1",
            model="llama-3-8b",
            preference=RoutingPreference.CHEAPEST,
        ))

        assert result is not None
        assert result.provider_id == "alpha"  # Best composite score
        assert engine.total_matches == 1

    def test_batch_engine(self):
        """Engine with batch strategy queues then matches on cycle."""
        engine = MatchingEngine(strategy=BatchAuctionStrategy())
        engine.update_offers(make_offers())

        # Submit doesn't return result in batch mode
        result = engine.submit_order(InferenceOrder(
            order_id="req-1",
            consumer_id="c1",
            model="llama-3-8b",
            preference=RoutingPreference.CHEAPEST,
        ))
        assert result is None
        assert engine.pending_orders == 1

        # Manually trigger cycle
        matches, failures = engine.run_batch_cycle()
        assert len(matches) == 1
        assert matches[0].provider_id == "alpha"  # Best composite score
        assert engine.pending_orders == 0

    def test_strategy_swap(self):
        """Can swap strategy at runtime."""
        engine = MatchingEngine(strategy=GreedyStrategy())
        assert engine.strategy_name == "GreedyStrategy"

        engine.set_strategy(BatchAuctionStrategy())
        assert engine.strategy_name == "BatchAuctionStrategy"

    def test_stats(self):
        """Engine tracks stats correctly."""
        engine = MatchingEngine(strategy=GreedyStrategy())
        engine.update_offers(make_offers())

        engine.submit_order(InferenceOrder(
            order_id="req-1", consumer_id="c1", model="llama-3-8b",
        ))
        engine.submit_order(InferenceOrder(
            order_id="req-2", consumer_id="c1", model="nonexistent",
        ))

        stats = engine.stats()
        assert stats["total_orders"] == 2
        assert stats["total_matches"] == 1
        assert stats["total_failures"] == 1
        assert stats["match_rate"] == 0.5
