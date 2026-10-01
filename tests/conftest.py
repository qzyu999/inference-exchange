import pytest


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Keep tests off the real ~/.inference-exchange/exchange.db."""
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "exchange.db"))
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")


@pytest.fixture(autouse=True)
def _reset_auth_rate_limit():
    """The signup/login limiter is per-IP and process-global; TestClient always uses one IP."""
    from inference_exchange.coordinator import routes_auth
    routes_auth._auth_attempts.clear()
