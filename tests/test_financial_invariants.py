"""Property-based testing for financial invariants.

Uses only pytest + stdlib (no Hypothesis). Generates random billing events
and asserts that the books always balance.
"""

import random

import pytest

from inference_exchange.coordinator.billing import (
    MICRO_PER_DOLLAR,
    BillingLedger,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _random_billing_event(
    ledger: BillingLedger,
    rng: random.Random,
    request_id: str,
    consumer_id: str = "c1",
    provider_id: str = "p1",
):
    """Generate a random billing event and return the bill."""
    input_tokens = rng.randint(1, 100_000)
    output_tokens = rng.randint(1, 100_000)
    price_in = rng.uniform(0.01, 5.0)
    price_out = rng.uniform(0.01, 5.0)
    return ledger.charge_request(
        request_id=request_id,
        consumer_id=consumer_id,
        provider_id=provider_id,
        model="test-model",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        price_per_mtok_input=price_in,
        price_per_mtok_output=price_out,
    )


# ---------------------------------------------------------------------------
# For N random requests: total_consumer_charges = total_provider_earnings + total_platform_fees
# ---------------------------------------------------------------------------

class TestBooksBalance:
    @pytest.mark.parametrize("seed", range(10))
    def test_total_balance_random_seed(self, seed):
        """For each seed, generate random events and verify total balance."""
        rng = random.Random(seed)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        n = rng.randint(10, 100)
        for i in range(n):
            _random_billing_event(ledger, rng, f"r-{seed}-{i}")

        total_cost = sum(b.cost_micro for b in ledger._history)
        total_earned = sum(b.provider_earning_micro for b in ledger._history)
        total_fees = sum(b.platform_fee_micro for b in ledger._history)
        assert total_cost == total_earned + total_fees

    def test_per_bill_invariant_across_random_events(self):
        """Each individual bill satisfies cost = earning + fee."""
        rng = random.Random(42)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(200):
            bill = _random_billing_event(ledger, rng, f"r-{i}")
            assert bill is not None
            assert bill.cost_micro == bill.provider_earning_micro + bill.platform_fee_micro


# ---------------------------------------------------------------------------
# No individual charge is negative
# ---------------------------------------------------------------------------

class TestNoNegativeCharges:
    @pytest.mark.parametrize("seed", range(10))
    def test_no_negative_amounts(self, seed):
        rng = random.Random(seed)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(50):
            bill = _random_billing_event(ledger, rng, f"r-{seed}-{i}")
            assert bill is not None
            assert bill.cost_micro >= 0, f"Negative cost: {bill.cost_micro}"
            assert bill.provider_earning_micro >= 0, f"Negative earning: {bill.provider_earning_micro}"
            assert bill.platform_fee_micro >= 0, f"Negative fee: {bill.platform_fee_micro}"


# ---------------------------------------------------------------------------
# Provider earning = 90% of cost (within integer rounding)
# ---------------------------------------------------------------------------

class TestProviderSplit:
    @pytest.mark.parametrize("seed", range(10))
    def test_provider_gets_ninety_percent(self, seed):
        rng = random.Random(seed)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(50):
            bill = _random_billing_event(ledger, rng, f"r-{seed}-{i}")
            assert bill is not None
            # platform_fee = cost * 10 // 100 (integer division)
            # provider_earning = cost - platform_fee
            expected_fee = bill.cost_micro * 10 // 100
            expected_earning = bill.cost_micro - expected_fee
            assert bill.platform_fee_micro == expected_fee
            assert bill.provider_earning_micro == expected_earning


# ---------------------------------------------------------------------------
# Platform fee = 10% of cost (within integer rounding)
# ---------------------------------------------------------------------------

class TestPlatformFee:
    @pytest.mark.parametrize("seed", range(10))
    def test_platform_fee_is_ten_percent(self, seed):
        rng = random.Random(seed)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(50):
            bill = _random_billing_event(ledger, rng, f"r-{seed}-{i}")
            assert bill is not None
            # Integer division: fee = cost * 10 // 100
            expected_fee = bill.cost_micro * 10 // 100
            assert bill.platform_fee_micro == expected_fee

    def test_fee_always_within_one_cent_of_ten_percent(self):
        """The fee should never deviate from 10% by more than 1 micro-USD (rounding)."""
        rng = random.Random(99)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(500):
            bill = _random_billing_event(ledger, rng, f"r-{i}")
            assert bill is not None
            ideal_fee = bill.cost_micro * 0.10
            assert abs(bill.platform_fee_micro - ideal_fee) <= 1.0


# ---------------------------------------------------------------------------
# Stress test: 1000 random billing events, verify the books balance
# ---------------------------------------------------------------------------

class TestStress:
    def test_thousand_events_balance(self):
        """1000 random billing events — the books must balance exactly."""
        rng = random.Random(2024)
        ledger = BillingLedger()
        ledger.get_or_create_consumer("c1", "Consumer")
        ledger.get_or_create_provider("p1", "Provider")

        for i in range(1000):
            bill = _random_billing_event(ledger, rng, f"stress-{i}")
            assert bill is not None

        total_cost = sum(b.cost_micro for b in ledger._history)
        total_earned = sum(b.provider_earning_micro for b in ledger._history)
        total_fees = sum(b.platform_fee_micro for b in ledger._history)

        # Exact balance
        assert total_cost == total_earned + total_fees

        # No negative amounts anywhere
        assert all(b.cost_micro >= 0 for b in ledger._history)
        assert all(b.provider_earning_micro >= 0 for b in ledger._history)
        assert all(b.platform_fee_micro >= 0 for b in ledger._history)

        # Sanity: we actually processed something
        assert total_cost > 0
        assert len(ledger._history) == 1000

    def test_multi_consumer_multi_provider_balance(self):
        """Multiple consumers and providers — total still balances."""
        rng = random.Random(7777)
        ledger = BillingLedger()

        consumers = [f"c{i}" for i in range(5)]
        providers = [f"p{i}" for i in range(3)]
        for c in consumers:
            ledger.get_or_create_consumer(c, f"Consumer-{c}")
        for p in providers:
            ledger.get_or_create_provider(p, f"Provider-{p}")

        for i in range(1000):
            consumer = rng.choice(consumers)
            provider = rng.choice(providers)
            input_tokens = rng.randint(1, 50_000)
            output_tokens = rng.randint(1, 50_000)
            price_in = rng.uniform(0.01, 5.0)
            price_out = rng.uniform(0.01, 5.0)
            bill = ledger.charge_request(
                request_id=f"multi-{i}",
                consumer_id=consumer,
                provider_id=provider,
                model="test",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                price_per_mtok_input=price_in,
                price_per_mtok_output=price_out,
            )
            assert bill is not None

        total_cost = sum(b.cost_micro for b in ledger._history)
        total_earned = sum(b.provider_earning_micro for b in ledger._history)
        total_fees = sum(b.platform_fee_micro for b in ledger._history)
        assert total_cost == total_earned + total_fees
