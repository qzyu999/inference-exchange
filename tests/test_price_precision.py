"""BILL-013: price precision and exact charge arithmetic."""
import random

import pytest

from inference_exchange.coordinator.store import Store
from inference_exchange.shared.money import PRICE_DECIMALS, cost_micro, has_price_precision


@pytest.mark.parametrize("price,ok", [
    (0, True), (0.05, True), (0.0015, True), (0.000001, True), (99.999999, True), (100, True),
    ("0.0500000000", True),  # trailing zeros from catalog decimal strings
    (0.0000001, False), (0.0833333333333333, False), (1e-7, False),
    (-0.01, False), (float("nan"), False), (float("inf"), False),
])
def test_price_precision_limit(price, ok):
    assert PRICE_DECIMALS == 6
    assert has_price_precision(price) is ok


@pytest.mark.parametrize("tokens,price,expected", [
    (300, 0.05, 15),          # float math gave 14
    (260, 0.15, 39),          # float math gave 38
    (1_000_000, 0.000001, 1), # smallest step: 1M tokens = 1 micro-USD
    (999_999, 0.000001, 0),   # rounded down
    (1, 100, 100),
    (1_000_000, 1.0, 1_000_000),
    (0, 5.0, 0),
])
def test_cost_is_exact_and_rounds_down(tokens, price, expected):
    assert cost_micro(tokens, price) == expected


def test_cost_matches_integer_reference_for_random_prices():
    rng = random.Random(13)
    for _ in range(20_000):
        units = rng.randint(0, 100_000_000)  # price in micro-USD per Mtok, up to $100
        tokens = rng.randint(0, 2_000_000)
        price = units / 1_000_000
        assert cost_micro(tokens, price) == tokens * units // 1_000_000, (tokens, price)


def test_store_charge_uses_exact_arithmetic(tmp_path):
    store = Store(db_path=tmp_path / "precision.db")
    cid = store.get_or_create_account("c1", "Consumer")["account_id"]
    bill = store.charge_request("r1", cid, "p1", "m", 4800, 4800, 0.05, 0.15)
    # 4800 x $0.05/Mtok = 240 and 4800 x $0.15/Mtok = 720. Float math gave 239 + 719.
    assert bill["cost_micro"] == 960
    assert bill["cost_micro"] == bill["provider_earning_micro"] + bill["platform_fee_micro"]
