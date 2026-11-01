"""AUTH-017: operators can suspend, ban, and restore accounts (#111)."""

import time

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app

CHAT = {"model": "test-model", "messages": [{"role": "user", "content": "hi"}], "stream": False}
ADMIN = "admin@example.com"


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", ADMIN)
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "suspend.db"))


def _client() -> TestClient:
    return TestClient(create_app(), base_url="https://testserver")


def _signup(c: TestClient, email: str) -> dict:
    r = c.post("/v1/auth/signup", json={"email": email, "password": "hunter22"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def setup(env):
    app_client = _client()
    admin = TestClient(app_client.app, base_url="https://testserver")
    _signup(admin, ADMIN)
    user = TestClient(app_client.app, base_url="https://testserver")
    info = _signup(user, "user@example.com")
    return admin, user, info


def _suspend(admin: TestClient, user_id: str, duration=None):
    return admin.post(f"/v1/admin/accounts/{user_id}/suspend", json={"reason": "spam", "duration_seconds": duration})


class TestSuspension:
    def test_suspended_key_is_denied(self, setup):
        admin, user, info = setup
        assert _suspend(admin, info["user_id"]).status_code == 200
        user.cookies.clear()
        r = user.post("/v1/chat/completions", json=CHAT, headers={"authorization": f"Bearer {info['api_key']}"})
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_suspended"
        assert user.get("/v1/exchange/balance", headers={"authorization": f"Bearer {info['api_key']}"}).status_code == 403

    def test_suspension_ends_sessions(self, setup):
        admin, user, info = setup
        assert user.get("/v1/auth/me").json().get("user_id") == info["user_id"]
        _suspend(admin, info["user_id"])
        # The old session cookie is invalid, and private account data needs auth in prod.
        assert user.get("/v1/auth/me").status_code == 401
        assert user.post("/v1/chat/completions", json=CHAT).status_code == 401

    def test_suspended_user_cannot_sign_in(self, setup):
        admin, user, info = setup
        _suspend(admin, info["user_id"])
        user.cookies.clear()
        r = user.post("/v1/auth/login", json={"email": "user@example.com", "password": "hunter22"})
        assert r.status_code == 403

    def test_temporary_suspension_expires(self, setup):
        admin, user, info = setup
        _suspend(admin, info["user_id"], duration=0.2)
        user.cookies.clear()
        auth = {"authorization": f"Bearer {info['api_key']}"}
        assert user.get("/v1/exchange/balance", headers=auth).status_code == 403
        time.sleep(0.3)
        assert user.get("/v1/exchange/balance", headers=auth).status_code == 200

    def test_unsuspend_restores_access(self, setup):
        admin, user, info = setup
        _suspend(admin, info["user_id"])
        assert admin.post(f"/v1/admin/accounts/{info['user_id']}/unsuspend", json={"reason": "appeal"}).status_code == 200
        user.cookies.clear()
        assert user.get("/v1/exchange/balance", headers={"authorization": f"Bearer {info['api_key']}"}).status_code == 200

    def test_actions_are_audited(self, setup):
        admin, _user, info = setup
        _suspend(admin, info["user_id"], duration=60)
        admin.post(f"/v1/admin/accounts/{info['user_id']}/unsuspend", json={})
        actions = admin.get(f"/v1/admin/account-actions?user_id={info['user_id']}").json()["actions"]
        assert [a["action"] for a in actions] == ["unsuspend", "suspend"]
        assert all(a["actor"] == ADMIN for a in actions)
        assert actions[1]["reason"] == "spam"

    def test_non_admin_cannot_suspend(self, setup):
        admin, user, info = setup
        r = user.post(f"/v1/admin/accounts/{info['user_id']}/suspend", json={"reason": "x"})
        assert r.status_code == 403
        assert user.get("/v1/admin/accounts").status_code == 403

    def test_reason_required(self, setup):
        admin, _user, info = setup
        r = admin.post(f"/v1/admin/accounts/{info['user_id']}/suspend", json={"reason": " "})
        assert r.status_code == 400

    def test_admin_account_list_has_no_secrets(self, setup):
        admin, _user, info = setup
        _suspend(admin, info["user_id"])
        accounts = admin.get("/v1/admin/accounts").json()["accounts"]
        row = next(a for a in accounts if a["user_id"] == info["user_id"])
        assert row["suspended"] and row["suspension_permanent"]
        assert "password_hash" not in row and "key_hash" not in row

    def test_suspension_survives_restart(self, setup):
        admin, _user, info = setup
        _suspend(admin, info["user_id"])
        fresh = _client()  # new app, same database
        r = fresh.get("/v1/exchange/balance", headers={"authorization": f"Bearer {info['api_key']}"})
        assert r.status_code == 403
