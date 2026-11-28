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


@pytest.fixture(autouse=True)
def _postgres_when_configured(request, monkeypatch):
    """With IE_TEST_DATABASE_URL set, every Store in the test uses PostgreSQL.

    Each database path the test names maps to its own schema (tests/pg.py).
    A test marked `sqlite_only` keeps SQLite: it checks a SQLite-only tool.
    """
    import pg

    base = pg.url()
    if not base or request.node.get_closest_marker("sqlite_only"):
        yield
        return
    from pathlib import Path

    from inference_exchange.coordinator import store as store_module

    schemas = pg.Schemas(base, request.node.nodeid)

    def resolve(db_path):
        if db_path is None:
            import os
            db_path = Path(os.environ.get("IE_DB_PATH", str(store_module.DB_PATH)))
        return "postgres", schemas.for_path(Path(db_path).resolve())

    opened = []
    real_init = store_module.Store.__init__

    def tracked_init(self, *args, **kwargs):
        real_init(self, *args, **kwargs)
        opened.append(self)

    monkeypatch.setattr(store_module, "resolve_backend", resolve)
    monkeypatch.setattr(store_module.Store, "__init__", tracked_init)
    yield
    for store in opened:  # free the server's connection slots
        try:
            store.close()
        except Exception:
            pass
    schemas.drop()


def pytest_configure(config):
    config.addinivalue_line("markers", "sqlite_only: checks a tool that reads SQLite files only")
