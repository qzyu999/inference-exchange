"""Legacy in-memory billing, used by tests only. Production uses store.py.

Billing — tracks consumer balances and provider earnings.

All amounts stored in micro-USD (1 USD = 1,000,000 micro-USD) to avoid
floating-point precision issues. Display as dollars in the API.
"""

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MICRO_PER_DOLLAR = 1_000_000


@dataclass
class Account:
    """A consumer or provider account."""

    account_id: str
    name: str
    balance_micro: int = 10 * MICRO_PER_DOLLAR  # Start with $10 free credit
    total_spent_micro: int = 0
    total_earned_micro: int = 0
    requests_made: int = 0
    tokens_consumed: int = 0
    created_at: float = field(default_factory=time.time)

    @property
    def balance_usd(self) -> float:
        return self.balance_micro / MICRO_PER_DOLLAR

    @property
    def total_spent_usd(self) -> float:
        return self.total_spent_micro / MICRO_PER_DOLLAR

    @property
    def total_earned_usd(self) -> float:
        return self.total_earned_micro / MICRO_PER_DOLLAR


@dataclass
class RequestBill:
    """A completed billing event."""

    request_id: str
    consumer_id: str
    provider_id: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_micro: int
    provider_earning_micro: int
    platform_fee_micro: int
    timestamp: float = field(default_factory=time.time)


class BillingLedger:
    """In-memory billing ledger. Tracks balances and transaction history."""

    # Platform fee: 10% of the request cost goes to the platform
    PLATFORM_FEE_PERCENT = 10

    def __init__(self):
        self._accounts: dict[str, Account] = {}
        self._history: list[RequestBill] = []
        # Default consumer account for unauthenticated requests
        self._ensure_account("default-consumer", "Anonymous")

    def _ensure_account(self, account_id: str, name: str) -> Account:
        if account_id not in self._accounts:
            self._accounts[account_id] = Account(account_id=account_id, name=name)
        return self._accounts[account_id]

    def get_or_create_consumer(self, consumer_id: str, name: str = "Consumer") -> Account:
        return self._ensure_account(consumer_id, name)

    def get_or_create_provider(self, provider_id: str, name: str = "Provider") -> Account:
        return self._ensure_account(provider_id, name)

    def get_account(self, account_id: str) -> Account | None:
        return self._accounts.get(account_id)

    def calculate_cost(
        self, input_tokens: int, output_tokens: int, price_per_mtok_input: float, price_per_mtok_output: float
    ) -> int:
        """Calculate cost in micro-USD given token counts and per-million-token prices."""
        input_cost = (input_tokens / 1_000_000) * price_per_mtok_input * MICRO_PER_DOLLAR
        output_cost = (output_tokens / 1_000_000) * price_per_mtok_output * MICRO_PER_DOLLAR
        return int(input_cost + output_cost)

    def charge_request(
        self,
        request_id: str,
        consumer_id: str,
        provider_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        price_per_mtok_input: float,
        price_per_mtok_output: float,
    ) -> RequestBill | None:
        """Charge consumer and credit provider for a completed request."""
        consumer = self._accounts.get(consumer_id)
        provider = self._accounts.get(provider_id)

        if not consumer or not provider:
            logger.warning(f"Billing: unknown account consumer={consumer_id} provider={provider_id}")
            return None

        total_cost = self.calculate_cost(
            input_tokens, output_tokens, price_per_mtok_input, price_per_mtok_output
        )

        # Minimum charge: $0.0001 (100 micro-USD)
        total_cost = max(total_cost, 100)

        # Split: provider gets 90%, platform gets 10%
        platform_fee = total_cost * self.PLATFORM_FEE_PERCENT // 100
        provider_earning = total_cost - platform_fee

        # Debit consumer
        consumer.balance_micro -= total_cost
        consumer.total_spent_micro += total_cost
        consumer.requests_made += 1
        consumer.tokens_consumed += input_tokens + output_tokens

        # Credit provider
        provider.balance_micro += provider_earning
        provider.total_earned_micro += provider_earning

        bill = RequestBill(
            request_id=request_id,
            consumer_id=consumer_id,
            provider_id=provider_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_micro=total_cost,
            provider_earning_micro=provider_earning,
            platform_fee_micro=platform_fee,
        )
        self._history.append(bill)

        logger.info(
            f"Billed: {output_tokens} tokens, "
            f"cost=${total_cost/MICRO_PER_DOLLAR:.6f}, "
            f"provider earns=${provider_earning/MICRO_PER_DOLLAR:.6f}"
        )

        return bill

    @property
    def recent_bills(self) -> list[RequestBill]:
        """Last 50 transactions."""
        return self._history[-50:]

    @property
    def total_volume_micro(self) -> int:
        """Total marketplace volume."""
        return sum(b.cost_micro for b in self._history)

    @property
    def total_requests(self) -> int:
        return len(self._history)

    def summary(self) -> dict:
        """Marketplace summary stats."""
        return {
            "total_requests": self.total_requests,
            "total_volume_usd": self.total_volume_micro / MICRO_PER_DOLLAR,
            "total_tokens": sum(b.input_tokens + b.output_tokens for b in self._history),
            "accounts": len(self._accounts),
        }
