import pytest


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Keep tests off the real ~/.inference-exchange/exchange.db."""
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "exchange.db"))
    monkeypatch.setenv("IE_TICKER_CACHE_PATH", str(tmp_path / "ticker-cache.json"))
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")


@pytest.fixture(autouse=True)
def _bind_built_apps(monkeypatch):
    """Tests read an app's services outside a request (dependencies.get_store()).

    Production binds services only inside each app's ASGI scope. In a test, the
    most recently built app is also bound to the test body until teardown.
    """
    from inference_exchange.coordinator import composition, context

    real = composition.build_services
    tokens = []

    def build_and_bind(store=None):
        services = real(store)
        tokens.append(context.bind(services))
        return services

    monkeypatch.setattr(composition, "build_services", build_and_bind)
    yield
    for token in reversed(tokens):
        context.unbind(token)


@pytest.fixture
def bound_services():
    """Bind real services, optionally around a given store, for tests that call helpers without an app."""
    from inference_exchange.coordinator import composition

    def bind(store=None, **overrides):
        services = composition.build_services(store)  # bound by _bind_built_apps
        for name, value in overrides.items():
            setattr(services, name, value)
        return services

    return bind
