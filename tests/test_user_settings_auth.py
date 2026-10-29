"""AUTH-019: verified admin flag and account/admin permissions."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "settings.db"))
    monkeypatch.setenv("IE_JWT_SECRET", "settings-roles-test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", "operator@example.com")
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    return TestClient(create_app(), base_url="https://testserver")


def _signup(client, email):
    response = client.post("/v1/auth/signup", json={"email": email, "password": "hunter22"})
    assert response.status_code == 200, response.text
    return response.json()


def test_admin_flag_comes_from_verified_session_and_current_allowlist(env, monkeypatch):
    _signup(env, "operator@example.com")
    original_cookie = env.cookies.get("ie_session")
    result = env.get("/v1/auth/me")
    assert result.status_code == 200
    assert result.json()["is_admin"] is True
    assert env.get("/v1/admin/state").status_code == 200
    # Removing an admin allowlist entry revokes privileges for the *same*
    # still-valid signed JWT, not only when the user signs in again.
    monkeypatch.setenv("IE_ADMIN_EMAILS", "different@example.com")
    assert env.get("/v1/auth/me").json()["is_admin"] is False
    assert env.get("/v1/admin/state").status_code == 403
    assert env.cookies.get("ie_session") == original_cookie


def test_regular_user_and_api_key_cannot_appear_admin(env):
    created = _signup(env, "member@example.com")
    assert env.get("/v1/auth/me").json()["is_admin"] is False
    assert env.get("/v1/admin/state").status_code == 403
    env.cookies.clear()
    key_result = env.get("/v1/auth/me", headers={"Authorization": "Bearer " + created["api_key"]})
    assert key_result.status_code == 200
    assert key_result.json()["is_admin"] is False
    assert "user_id" not in key_result.json()
    assert env.get("/v1/auth/me").status_code == 401


def test_provider_token_and_revoked_session_cannot_appear_admin(env):
    account = _signup(env, "operator@example.com")
    token = env.cookies.get("ie_session")
    store = dependencies.get_store()
    provider_token = store.create_provider_token("m6")
    env.cookies.clear()
    assert env.get("/v1/auth/me", headers={"Authorization": "Bearer " + provider_token}).status_code == 401
    store.bump_session_version(account["user_id"])
    assert env.get("/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
    assert env.get("/v1/admin/state", headers={"Authorization": "Bearer " + token}).status_code == 403


def test_suspended_session_cannot_retain_admin_flag(env):
    account = _signup(env, "operator@example.com")
    store = dependencies.get_store()
    assert env.get("/v1/auth/me").json()["is_admin"] is True
    store.suspend_user(account["user_id"], "test", account["user_id"], None)
    # Suspension revokes old sessions; auth/me returns 401, admin stays 403.
    assert env.get("/v1/auth/me").status_code == 401
    assert env.get("/v1/admin/state").status_code == 403
