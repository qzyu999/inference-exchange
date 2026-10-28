"""#131: simulated-credit reset must not be a public production mint."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app


@pytest.fixture
def prod(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "credits.db"))
    monkeypatch.setenv("IE_JWT_SECRET", "alpha-credit-reset-test")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", "admin@example.test")
    monkeypatch.delenv("IE_SIGNUP_DISABLED", raising=False)
    app = create_app()
    return TestClient(app, base_url="https://testserver")


def _signup(app, email):
    c = TestClient(app, base_url="https://testserver")
    r = c.post("/v1/auth/signup", json={"email": email, "password": "strong-passphrase-1"})
    assert r.status_code == 200, r.text
    return c, r.json()["user_id"]


def test_production_reset_denied_and_balance_unchanged_for_user_and_admin(prod):
    store = dependencies.get_store()
    for address in ("user@example.test", "admin@example.test"):
        client, user_id = _signup(prod.app, address)
        store._conn.execute("UPDATE accounts SET balance_micro = 1234 WHERE account_id = ?", (user_id,))
        store._conn.commit()
        for _ in range(3):
            response = client.post("/v1/auth/reset-balance")
            assert response.status_code == 403
            assert "disabled" in response.json()["error"]
        assert store.get_account(user_id)["balance_micro"] == 1234


def test_production_reset_requires_auth(prod):
    assert prod.post("/v1/auth/reset-balance").status_code == 401
    assert prod.post("/v1/auth/reset-balance", headers={
        "Authorization": "Bearer sk-ie-unknown"
    }).status_code == 401


def test_production_reset_disabled_in_disclosed_billing_config(prod):
    response = prod.get("/v1/exchange/billing-config")
    assert response.status_code == 200
    assert response.json()["allow_balance_reset"] is False


def test_development_reset_still_available(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "dev-credits.db"))
    monkeypatch.delenv("IE_SIGNUP_DISABLED", raising=False)
    client = TestClient(create_app())
    assert client.get("/v1/exchange/billing-config").json()["allow_balance_reset"] is True
    response = client.post("/v1/auth/reset-balance")
    assert response.status_code == 200
    assert response.json()["balance_usd"] == 10.0
