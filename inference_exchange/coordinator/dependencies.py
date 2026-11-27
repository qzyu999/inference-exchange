"""Accessors for the services of the app that serves the current request.

The objects live in `composition.Services`, one set per app. These functions
read the set bound to the current context; they hold no state themselves.
Route modules can keep importing from here while they migrate.
"""

import logging
from typing import Any, Protocol

from .context import current
from .event_bus import EventBus
from .provider_hub import ProviderHub
from .reputation import ReputationTracker
from .tps_tracker import TPSTracker
from .traces import MAX_TRACES, TRACE_OWNER_KEY  # noqa: F401

logger = logging.getLogger(__name__)


class AuthLike(Protocol):
    """Protocol for auth adapters (both memory and store-backed)."""
    @property
    def default_key(self) -> str: ...
    def validate_key(self, raw_key: str) -> dict | None: ...
    def resolve_consumer(self, authorization: str | None) -> str: ...
    def list_keys(self) -> list[dict]: ...


class BillingLike(Protocol):
    """Protocol for billing adapters (both memory and store-backed)."""
    PLATFORM_FEE_PERCENT: int
    def charge_request(self, **kwargs: Any) -> Any: ...
    def get_or_create_consumer(self, consumer_id: str, name: str) -> Any: ...
    def get_or_create_provider(self, provider_id: str, name: str) -> Any: ...
    @property
    def recent_bills(self) -> list: ...
    @property
    def total_requests(self) -> int: ...
    def summary(self) -> dict: ...


def _add_trace(trace: dict, consumer_id: str | None = None):
    current().traces.add(trace, consumer_id)


def _complete_trace(request_id: str, consumer_id: str, served_model: str | None, latency_ms: int,
                    provider_country=None, caller_country=None):
    current().traces.complete(request_id, consumer_id, served_model, latency_ms, provider_country, caller_country)


def traces_for(consumer_id: str | None, limit: int = 30) -> list[dict]:
    return current().traces.recent(consumer_id, limit)


def get_hub() -> ProviderHub:
    return current().hub


def get_billing() -> BillingLike:
    return current().billing


def get_auth() -> AuthLike:
    return current().auth


def get_tps_tracker() -> TPSTracker:
    return current().tps


def get_reputation_tracker() -> ReputationTracker:
    return current().reputation


def get_event_bus() -> EventBus | None:
    return current().event_bus


def get_store():
    return current().store


def get_audit_log():
    return current().audit_log


def get_price_collector():
    return current().price_collector


def get_rate_limiter():
    return current().rate_limiter


async def outcome_cleanup_loop():
    import asyncio
    while True:
        await asyncio.sleep(60)
        try:
            get_store().request_outcomes(None, 1)
        except Exception:
            logger.warning("Request outcome retention failed")
