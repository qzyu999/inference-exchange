"""Composition root: every stateful coordinator object, built once per app.

`create_app()` calls `build_services()` and stores the result on
`app.state.services`. `ServicesMiddleware` binds it to the current context for
every HTTP, WebSocket and lifespan scope, so code that runs for that app,
including tasks it starts, reads that app's objects through `current()`.
Two apps in one process share no mutable state (paid-path design §3.3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .audit_log import AuditLog
from .context import bind, current, unbind  # noqa: F401 (current is re-exported)
from .country_activity import CountryActivity
from .event_bus import EventBus
from .metrics import Metrics
from .operator_controls import OperatorControls
from .provider_hub import ProviderHub
from .rate_limiter import RateLimiter
from .reputation import ReputationTracker
from .store import Store
from .tps_tracker import TPSTracker
from .traces import TraceLog


@dataclass
class Services:
    store: Store
    hub: ProviderHub
    auth: Any
    billing: Any
    tps: TPSTracker
    reputation: ReputationTracker
    event_bus: EventBus
    audit_log: AuditLog
    traces: TraceLog
    rate_limiter: RateLimiter
    controls: OperatorControls
    country_activity: CountryActivity
    metrics: Metrics
    price_collector: Any = None
    auth_attempts: dict[str, list[float]] = field(default_factory=dict)


def build_services(store: Store | None = None) -> Services:
    from .main import StoreAuthAdapter, StoreBillingAdapter
    from .price_collector import PriceCollector

    store = Store() if store is None else store
    services = Services(
        store=store,
        hub=ProviderHub(),
        auth=StoreAuthAdapter(store),
        billing=StoreBillingAdapter(store),
        tps=TPSTracker(),
        reputation=ReputationTracker(),
        event_bus=EventBus(),
        audit_log=AuditLog(),
        traces=TraceLog(store),
        rate_limiter=RateLimiter(),
        controls=OperatorControls(),
        country_activity=CountryActivity(),
        metrics=Metrics(),
    )
    services.price_collector = PriceCollector(store=store)
    return services


class ServicesMiddleware:
    """Pure ASGI middleware, so it covers websocket and lifespan scopes too."""

    def __init__(self, app, services: Services):
        self.app = app
        self.services = services

    async def __call__(self, scope, receive, send):
        token = bind(self.services)
        try:
            await self.app(scope, receive, send)
        finally:
            unbind(token)
