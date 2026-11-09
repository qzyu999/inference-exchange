"""Price and charge precision (BILL-013).

Prices are USD per million tokens with at most PRICE_DECIMALS decimal places.
The smallest price step is $0.000001/Mtok. At that step, one million tokens
cost exactly one micro-USD, the unit that the ledger stores.

A charge in micro-USD is tokens x price($/Mtok), rounded down. Decimal
arithmetic computes it exactly. Binary float arithmetic does not.
"""

from decimal import ROUND_FLOOR, Decimal, InvalidOperation

MICRO_PER_DOLLAR = 1_000_000
PRICE_DECIMALS = 6
PRICE_STEP = Decimal(1).scaleb(-PRICE_DECIMALS)  # 0.000001


def _decimal(price: float | int | str) -> Decimal:
    try:
        # repr() gives the shortest decimal that round-trips, for example 0.05 -> "0.05".
        d = Decimal(price if isinstance(price, str) else repr(price))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("Invalid price") from exc
    if not d.is_finite() or d < 0:
        raise ValueError("Invalid price")
    return d


def has_price_precision(price: float | int | str) -> bool:
    """True when the price has at most PRICE_DECIMALS decimal places."""
    try:
        d = _decimal(price)
    except ValueError:
        return False
    # Trailing zeros are allowed: "0.0500000000" has 2 significant decimal places.
    return d == d.quantize(PRICE_STEP)


def cost_micro(tokens: int, price: float | int | str) -> int:
    """Exact charge in integer micro-USD for `tokens` at `price` $/Mtok, rounded down."""
    if tokens <= 0:
        return 0
    # tokens / 1e6 Mtok x price $/Mtok x 1e6 micro/$ = tokens x price micro-USD.
    return int((Decimal(tokens) * _decimal(price)).to_integral_value(rounding=ROUND_FLOOR))
