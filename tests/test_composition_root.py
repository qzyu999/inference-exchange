"""Each app instance owns its state (paid-path design §3.3, slice 1)."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app

BODY = {"model": "m", "messages": [{"role": "user", "content": "hi"}], "ocip_min_confidence": "open"}


def _key(client: TestClient) -> str:
    return client.get("/health?include_key=1").json()["default_api_key"]


@pytest.fixture
def two_apps(tmp_path, monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "a.db"))
    app_a = create_app()
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "b.db"))
    app_b = create_app()
    with TestClient(app_a) as a, TestClient(app_b) as b:
        yield a, b


def test_two_apps_share_no_state(two_apps):
    a, b = two_apps
    sa, sb = a.app.state.services, b.app.state.services
    for name in ("store", "hub", "rate_limiter", "controls", "traces", "auth_attempts",
                 "event_bus", "country_activity", "metrics"):
        assert getattr(sa, name) is not getattr(sb, name), name

    # The first app still serves its own database after the second app is built.
    key_a = _key(a)
    assert a.get("/v1/exchange/balance", headers={"authorization": f"Bearer {key_a}"}).status_code == 200
    assert b.get("/v1/exchange/balance", headers={"authorization": f"Bearer {key_a}"}).status_code == 401


def test_rate_limit_is_per_app(two_apps):
    a, b = two_apps
    a.app.state.services.rate_limiter._burst = 0  # every request in app a is limited
    ra = a.post("/v1/chat/completions", headers={"authorization": f"Bearer {_key(a)}"}, json=BODY)
    rb = b.post("/v1/chat/completions", headers={"authorization": f"Bearer {_key(b)}"}, json=BODY)
    assert ra.status_code == 429
    assert rb.status_code != 429


def test_operator_pause_is_per_app(two_apps):
    a, b = two_apps
    a.app.state.services.controls.inference_paused = True
    ra = a.post("/v1/chat/completions", headers={"authorization": f"Bearer {_key(a)}"}, json=BODY)
    rb = b.post("/v1/chat/completions", headers={"authorization": f"Bearer {_key(b)}"}, json=BODY)
    assert ra.status_code == 503 and ra.json()["error"]["code"] == "inference_paused"
    assert rb.json()["error"]["code"] != "inference_paused"


def test_metrics_counters_are_per_app(two_apps):
    a, b = two_apps
    for _ in range(3):
        a.get("/health")
    count = lambda c: sum(n for (m, route, _), n in c.app.state.services.metrics.requests.items()
                          if m == "GET" and route == "/health")
    assert count(a) == 3
    assert count(b) == 0


def test_no_module_global_holds_app_state():
    """Rule 5 of the paid-path design: the composition root creates every stateful object."""
    import importlib
    import pkgutil

    import inference_exchange.coordinator as pkg
    from inference_exchange.coordinator.country_activity import CountryActivity
    from inference_exchange.coordinator.event_bus import EventBus
    from inference_exchange.coordinator.metrics import Metrics
    from inference_exchange.coordinator.operator_controls import OperatorControls
    from inference_exchange.coordinator.provider_hub import ProviderHub
    from inference_exchange.coordinator.rate_limiter import RateLimiter
    from inference_exchange.coordinator.store import Store
    from inference_exchange.coordinator.traces import TraceLog

    stateful = (CountryActivity, EventBus, Metrics, OperatorControls, ProviderHub, RateLimiter, Store, TraceLog)
    offenders = []
    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name == "__main__":  # importing it starts the server
            continue
        module = importlib.import_module(f"{pkg.__name__}.{info.name}")
        offenders += [f"{info.name}.{name}" for name, value in vars(module).items() if isinstance(value, stateful)]
    assert offenders == []
