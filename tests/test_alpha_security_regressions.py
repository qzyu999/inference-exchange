"""Alpha security regressions: fail closed on trust and credentials (P1, P6)."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import Store
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage


@pytest.fixture
def prod_client(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "alpha-test-jwt-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "security.db"))
    return TestClient(create_app(), base_url="https://testserver")


@pytest.mark.parametrize("trust", ["Hardened", "hardened ", "unknown", ""])
def test_unknown_minimum_trust_returns_400(prod_client, trust):
    response = prod_client.post("/v1/chat/completions", json={
        "messages": [{"role": "user", "content": "hello"}],
        "ocip_min_confidence": trust,
        "stream": False,
    })
    assert response.status_code == 400
    assert "ocip_min_confidence" in response.json()["error"]["message"]


@pytest.mark.parametrize("path", [
    "/v1/auth/me",
    "/v1/exchange/balance",
    "/v1/exchange/history",
    "/v1/exchange/traces",
])
def test_account_data_is_private_without_credentials_in_prod(prod_client, path):
    response = prod_client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_api_key"


def test_revoked_session_cookie_does_not_fall_back_to_shared_account(prod_client):
    signup = prod_client.post("/v1/auth/signup", json={
        "email": "test@example.com", "password": "hunter22",
    })
    assert signup.status_code == 200
    cookie = prod_client.cookies.get("ie_session")
    assert cookie
    assert prod_client.get("/v1/exchange/balance").status_code == 200

    assert prod_client.post("/v1/auth/logout").status_code == 200
    for path in ("/v1/auth/me", "/v1/exchange/balance", "/v1/exchange/history"):
        response = prod_client.get(path, headers={"cookie": f"ie_session={cookie}"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "invalid_api_key"


def test_matcher_refuses_unknown_confidence_even_outside_http_validation():
    from inference_exchange.coordinator.provider_hub import ProviderHub

    hub = ProviderHub()
    with pytest.raises(KeyError):
        hub.select_provider("default", min_confidence="Hardened")
    with pytest.raises(ValueError):
        hub.explain_no_match("default", min_confidence="Hardened")


def test_production_rejects_provider_without_token_on_empty_database(prod_client):
    assert Store().list_provider_tokens() == []
    with pytest.raises(WebSocketDisconnect) as exc:
        with prod_client.websocket_connect("/ws/provider") as ws:
            ws.receive_text()
    assert exc.value.code == 4003


def test_production_accepts_valid_provider_token(prod_client):
    token = Store().create_provider_token("alpha-test-provider")
    registration = RegisterMessage(
        provider_name="alpha-test-provider",
        capabilities=ProviderCapabilities(models=["test-model"]),
    )
    with prod_client.websocket_connect(f"/ws/provider?token={token}") as ws:
        ws.send_json(registration.model_dump())
        result = ws.receive_json()
        assert result["type"] == "registered"
        assert result["provider_id"]
