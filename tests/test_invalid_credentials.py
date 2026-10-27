"""AUTH-016: invalid, revoked, or expired credentials get 401 everywhere (#110)."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.routes_auth import create_jwt

CHAT = {"messages": [{"role": "user", "content": "hi"}], "stream": False}

# Every endpoint that resolves the caller's account
PRIVATE_ENDPOINTS = [
    ("GET", "/v1/auth/me", None),
    ("GET", "/v1/exchange/balance", None),
    ("GET", "/v1/exchange/history", None),
    ("GET", "/v1/exchange/traces", None),
    ("POST", "/v1/auth/reset-balance", None),
    ("POST", "/v1/chat/completions", CHAT),
]


@pytest.fixture(params=["dev", "prod"])
def client(request, monkeypatch):
    monkeypatch.setenv("IE_ENV", request.param)
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    # https so the Secure session cookie set in prod is sent back
    return TestClient(create_app(), base_url="https://testserver")


def _call(c: TestClient, method: str, path: str, body, auth: str):
    return c.request(method, path, json=body, headers={"authorization": auth})


def _revoked_key(c: TestClient) -> str:
    r = c.post("/v1/auth/signup", json={"email": "r@example.com", "password": "hunter22"})
    key = r.json()["api_key"]
    key_id = c.get("/v1/auth/keys").json()["keys"][0]["key_id"]
    assert c.delete(f"/v1/auth/keys/{key_id}").status_code == 200
    c.cookies.clear()
    return key


class TestInvalidCredentials:
    @pytest.mark.parametrize("method,path,body", PRIVATE_ENDPOINTS)
    def test_unknown_key_rejected(self, client, method, path, body):
        r = _call(client, method, path, body, "Bearer sk-ie-00000000000000000000000000000000")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "invalid_api_key"

    @pytest.mark.parametrize("method,path,body", PRIVATE_ENDPOINTS)
    def test_revoked_key_rejected(self, client, method, path, body):
        key = _revoked_key(client)
        r = _call(client, method, path, body, f"Bearer {key}")
        assert r.status_code == 401

    def test_expired_bearer_jwt_rejected(self, client):
        token = create_jwt({"user_id": "user-x", "sv": 0}, ttl_hours=-1)
        r = client.get("/v1/exchange/balance", headers={"authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_garbage_header_rejected(self, client):
        r = client.get("/v1/exchange/balance", headers={"authorization": "Basic Zm9vOmJhcg=="})
        assert r.status_code == 401

    def test_openai_error_shape(self, client):
        r = client.post("/v1/chat/completions", json=CHAT, headers={"authorization": "Bearer sk-ie-bad"})
        err = r.json()["error"]
        assert set(err) >= {"message", "type", "code"}

    def test_valid_key_still_works(self, client):
        r = client.post("/v1/auth/signup", json={"email": "v@example.com", "password": "hunter22"})
        key = r.json()["api_key"]
        user_id = r.json()["user_id"]
        client.cookies.clear()
        bal = client.get("/v1/exchange/balance", headers={"authorization": f"Bearer {key}"})
        assert bal.status_code == 200 and bal.json()["consumer_id"] == user_id


class TestNoCredentials:
    def test_dev_without_header_uses_anonymous_account(self, monkeypatch):
        monkeypatch.setenv("IE_ENV", "dev")
        monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
        c = TestClient(create_app())
        assert c.get("/v1/exchange/balance").json()["consumer_id"] == "default-consumer"
