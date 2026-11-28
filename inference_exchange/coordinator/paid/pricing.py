"""Pricing bounds and charges (design §4 rules 2 and 5, §8.6). All pure, all integer micro-USD.

- `input_bound`: prompt tokens can never exceed it, for any tokenizer (BILL-018).
- `bound`: the maximum charge, which becomes the hold before dispatch (BILL-015).
- `charge`: the debit for validated usage, capped at the hold (BILL-016, D6).
- `parse_usage`: accepts upstream usage only when it is well formed (BILL-017).
- `interrupted_charge`: the delivered lower bound when the client leaves (BILL-019).
"""

from __future__ import annotations

from dataclasses import dataclass

from inference_exchange.shared.money import cost_micro

from .model import Charge, Rates, Usage

MIN_CHARGE_MICRO = 100  # BILL-004
# Chat templates add role and separator tokens to each message. 16 covers the
# templates of the models IE serves; a registered tokenizer can tighten it.
MESSAGE_OVERHEAD_TOKENS = 16


def cost(tokens: int, price: str | float) -> int:
    return cost_micro(tokens, price)


def input_bound(messages: list[dict]) -> int:
    """UTF-8 bytes of every message's content, plus a fixed overhead per message.

    Every byte-level BPE tokenizer emits at most one token per byte, so this is
    an upper bound on prompt tokens that needs no tokenizer.
    """
    total = 0
    for m in messages:
        content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        if not isinstance(content, str):
            content = str(content)
        total += len(content.encode("utf-8")) + MESSAGE_OVERHEAD_TOKENS
    return total


def bound(*, input_tokens: int, max_tokens: int, rates: Rates) -> int:
    """The most this request can cost. Cached input is cheaper, so bill all input at the input rate."""
    return max(cost(input_tokens, rates.input) + cost(max_tokens, rates.output), MIN_CHARGE_MICRO)


def raw_cost(usage: Usage, rates: Rates) -> int:
    fresh = max(0, usage.prompt_tokens - usage.cached_tokens)
    cache_rate = rates.cache if float(rates.cache) > 0 else rates.input
    return (cost(fresh, rates.input) + cost(usage.cached_tokens, cache_rate)
            + cost(usage.completion_tokens, rates.output))


def charge(usage: Usage, rates: Rates, hold: int) -> Charge:
    billable = max(raw_cost(usage, rates), MIN_CHARGE_MICRO)
    amount = min(billable, hold)
    return Charge(amount=amount, excess=billable - amount)


def interrupted_charge(*, delivered_deltas: int, rates: Rates, hold: int) -> int:
    """Each delivered content delta held at least one token: a provable lower bound."""
    lower = cost(max(0, delivered_deltas), rates.output) + cost(1, rates.input)
    return min(max(lower, MIN_CHARGE_MICRO), hold)


@dataclass(frozen=True)
class InvalidUsage:
    reason: str


def _count(raw: dict, key: str, *, required: bool):
    if key not in raw or raw[key] is None:
        return InvalidUsage("missing") if required else 0
    value = raw[key]
    if isinstance(value, bool) or not isinstance(value, int):
        return InvalidUsage("not_integer")
    if value < 0:
        return InvalidUsage("negative")
    return value


def parse_usage(raw: dict, *, max_tokens: int, input_bound: int) -> Usage | InvalidUsage:
    counts = {}
    for key, required in (("prompt_tokens", True), ("completion_tokens", True), ("cached_tokens", False)):
        value = _count(raw, key, required=required)
        if isinstance(value, InvalidUsage):
            return value
        counts[key] = value
    usage = Usage(counts["prompt_tokens"], counts["completion_tokens"], counts["cached_tokens"])
    if usage.cached_tokens > usage.prompt_tokens:
        return InvalidUsage("cached_above_prompt")
    if usage.completion_tokens > max_tokens:
        return InvalidUsage("completion_above_max_tokens")
    if usage.prompt_tokens > input_bound:
        return InvalidUsage("prompt_above_input_bound")
    return usage
