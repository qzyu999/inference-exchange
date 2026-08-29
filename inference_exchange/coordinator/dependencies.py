"""Global singletons and shared state for the coordinator API.

All route modules import from here to get access to the ProviderHub,
BillingLedger, AuthStore, etc. The singletons are set once at startup
by main.py via the set_* functions.
"""

import logging

from .auth_memory import AuthStore
from .billing_memory import BillingLedger
from .event_bus import EventBus
from .provider_hub import ProviderHub
from .rate_limiter import RateLimiter
from .reputation import ReputationTracker
from .tps_tracker import TPSTracker

logger = logging.getLogger(__name__)

# --- Request trace log (ring buffer of recent request decisions) ---

_request_traces: list[dict] = []
MAX_TRACES = 100


def _add_trace(trace: dict):
    _request_traces.append(trace)
    if len(_request_traces) > MAX_TRACES:
        _request_traces.pop(0)


# --- Global singletons (injected from main.py at startup) ---

_hub: ProviderHub | None = None
_billing: BillingLedger | None = None
_auth: AuthStore | None = None
_tps: TPSTracker | None = None
_reputation: ReputationTracker | None = None
_event_bus: EventBus | None = None
_rate_limiter: RateLimiter = RateLimiter()  # Default: 30 req/min, burst 10


def set_hub(hub: ProviderHub):
    global _hub
    _hub = hub


def set_billing(billing: BillingLedger):
    global _billing
    _billing = billing


def set_auth(auth: AuthStore):
    global _auth
    _auth = auth


def set_tps_tracker(tracker: TPSTracker):
    global _tps
    _tps = tracker


def set_reputation(tracker: ReputationTracker):
    global _reputation
    _reputation = tracker


def set_event_bus(bus: EventBus):
    global _event_bus
    _event_bus = bus


def get_hub() -> ProviderHub:
    if _hub is None:
        raise RuntimeError("ProviderHub not initialized")
    return _hub


def get_billing() -> BillingLedger:
    if _billing is None:
        raise RuntimeError("BillingLedger not initialized")
    return _billing


def get_auth() -> AuthStore:
    if _auth is None:
        raise RuntimeError("AuthStore not initialized")
    return _auth


def get_tps_tracker() -> TPSTracker:
    if _tps is None:
        raise RuntimeError("TPSTracker not initialized")
    return _tps


def get_reputation_tracker() -> ReputationTracker:
    if _reputation is None:
        raise RuntimeError("ReputationTracker not initialized")
    return _reputation


def get_event_bus() -> EventBus | None:
    """Return the event bus, or None if not yet initialized."""
    return _event_bus
