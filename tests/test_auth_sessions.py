"""Session revocation, API key revocation, account deletion, GitHub OAuth callback."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    return TestClient(create_app())


def signup(c: TestClient, email: str = "a@example.com") -> dict:
    r = c.post("/v1/auth/signup", json={"email": email, "password": "hunter22"})
    assert r.status_code == 200, r.text
    return r.json()


class TestSessions:
    def test_logout_invalidates_old_jwt(self, client):
        signup(client)
        token = client.cookies.get("ie_session")
        assert client.get("/v1/auth/me").json().get("user_id")
        client.post("/v1/auth/logout")
        # Replaying the old JWT no longer authenticates
        r = client.get("/v1/auth/me", headers={"authorization": f"Bearer {token}"}, cookies={})
        assert "user_id" not in r.json()

    def test_password_auth_off_in_prod_by_default(self, monkeypatch):
        monkeypatch.setenv("IE_ENV", "prod")
        monkeypatch.setenv("IE_JWT_SECRET", "s")
        c = TestClient(create_app())
        assert c.post("/v1/auth/signup", json={"email": "a@b.c", "password": "hunter22"}).status_code == 403
        assert c.get("/v1/auth/config").json() == {"github": False, "password": False}

    def test_prod_blocks_anonymous_inference(self, monkeypatch):
        monkeypatch.setenv("IE_ENV", "prod")
        monkeypatch.setenv("IE_JWT_SECRET", "s")
        c = TestClient(create_app())
        r = c.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "hi"}], "stream": False})
        assert r.status_code == 401


class TestKeysAndAccount:
    def test_revoked_key_stops_working(self, client):
        key = signup(client)["api_key"]
        key_id = client.get("/v1/auth/keys").json()["keys"][0]["key_id"]
        assert client.delete(f"/v1/auth/keys/{key_id}").status_code == 200
        assert client.get("/v1/auth/keys").json()["keys"] == []
        client.cookies.clear()
        me = client.get("/v1/auth/me", headers={"authorization": f"Bearer {key}"}).json()
        assert me["consumer_id"] == "default-consumer"

    def test_cannot_revoke_other_users_key(self, client):
        signup(client, "a@example.com")
        key_id = client.get("/v1/auth/keys").json()["keys"][0]["key_id"]
        client.cookies.clear()
        signup(client, "b@example.com")
        assert client.delete(f"/v1/auth/keys/{key_id}").status_code == 404

    def test_delete_account(self, client):
        signup(client)
        assert client.delete("/v1/auth/account").status_code == 200
        assert "user_id" not in client.get("/v1/auth/me").json()


class TestGitHubOAuth:
    @pytest.fixture
    def gh_client(self, monkeypatch, client):
        monkeypatch.setenv("IE_GITHUB_CLIENT_ID", "cid")
        monkeypatch.setenv("IE_GITHUB_CLIENT_SECRET", "csecret")
        return client

    def _start(self, c: TestClient) -> str:
        r = c.get("/v1/auth/github/login", follow_redirects=False)
        assert r.status_code == 302 and "code_challenge=" in r.headers["location"]
        return c.cookies.get("ie_oauth_state").split(".")[0]

    def test_rejects_bad_state(self, gh_client):
        self._start(gh_client)
        r = gh_client.get("/v1/auth/github/callback?code=x&state=wrong", follow_redirects=False)
        assert r.status_code == 302 and "error=state" in r.headers["location"]

    def test_creates_user_and_session(self, gh_client):
        state = self._start(gh_client)
        identity = {"id": 42, "login": "octo", "email": "octo@example.com", "name": "Octo", "created_at": "2015-01-01T00:00:00Z"}
        with patch("inference_exchange.coordinator.oauth_github._fetch_github_identity", return_value=identity):
            r = gh_client.get(f"/v1/auth/github/callback?code=c&state={state}", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/chat"
        me = gh_client.get("/v1/auth/me").json()
        assert me["email"] == "octo@example.com" and me["balance_usd"] == 10.0

    def test_rejects_new_github_account(self, gh_client, monkeypatch):
        monkeypatch.setenv("IE_GITHUB_MIN_AGE_DAYS", "30")
        state = self._start(gh_client)
        identity = {"id": 7, "login": "fresh", "email": "", "created_at": "2099-01-01T00:00:00Z"}
        with patch("inference_exchange.coordinator.oauth_github._fetch_github_identity", return_value=identity):
            r = gh_client.get(f"/v1/auth/github/callback?code=c&state={state}", follow_redirects=False)
        assert "account_too_new" in r.headers["location"]
