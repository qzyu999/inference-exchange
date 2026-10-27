"""OPS-008/009/010: inference pause, signup switch, per-account concurrency, queue controls (#112)."""

import asyncio
from unittest.mock import patch

import pytest
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.operator_controls import get_controls, run_guarded
from inference_exchange.coordinator.provider_hub import ProviderHub
from inference_exchange.shared.errors import ConcurrencyLimit, InferencePaused
from inference_exchange.shared.protocol import InferenceRequest

CHAT = {"messages": [{"role": "user", "content": "hi"}], "stream": False}
ADMIN = "admin@example.com"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", ADMIN)
    # No provider is connected in these tests; keep the queue wait short
    monkeypatch.setenv("IE_QUEUE_TIMEOUT_SECONDS", "0.05")
    return monkeypatch


def _signup(c: TestClient, email: str) -> dict:
    r = c.post("/v1/auth/signup", json={"email": email, "password": "hunter22"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def clients(env):
    base = TestClient(create_app(), base_url="https://testserver")
    admin = TestClient(base.app, base_url="https://testserver")
    _signup(admin, ADMIN)
    user = TestClient(base.app, base_url="https://testserver")
    info = _signup(user, "user@example.com")
    return admin, user, info


class TestInferencePause:
    def test_admin_pause_rejects_new_inference(self, clients):
        admin, user, _ = clients
        assert admin.post("/v1/admin/controls", json={"inference_paused": True}).json()["inference_paused"]
        r = user.post("/v1/chat/completions", json=CHAT)
        assert r.status_code == 503 and r.json()["detail"]["type"] == "inference_paused"
        admin.post("/v1/admin/controls", json={"inference_paused": False})
        assert user.post("/v1/chat/completions", json=CHAT).json()["detail"]["type"] != "inference_paused"

    def test_pause_from_env(self, env):
        env.setenv("IE_INFERENCE_PAUSED", "1")
        c = TestClient(create_app(), base_url="https://testserver")
        _signup(c, "u@example.com")
        assert c.post("/v1/chat/completions", json=CHAT).status_code == 503

    def test_pause_covers_confidential_path(self, clients):
        admin, user, _ = clients
        admin.post("/v1/admin/controls", json={"inference_paused": True})
        r = user.post("/v1/confidential/infer", json={"session_id": "s", "encrypted_envelope": {}})
        assert r.status_code == 503 and r.json()["detail"]["type"] == "inference_paused"


class TestSignupSwitch:
    def test_signup_disabled_blocks_new_accounts_only(self, clients):
        admin, user, _ = clients
        admin.post("/v1/admin/controls", json={"signup_disabled": True})
        fresh = TestClient(admin.app, base_url="https://testserver")
        r = fresh.post("/v1/auth/signup", json={"email": "new@example.com", "password": "hunter22"})
        assert r.status_code == 403 and r.json()["code"] == "signup_disabled"
        r = fresh.post("/v1/auth/login", json={"email": "user@example.com", "password": "hunter22"})
        assert r.status_code == 200

    def test_signup_disabled_blocks_new_github_identity(self, env):
        env.setenv("IE_SIGNUP_DISABLED", "1")
        env.setenv("IE_GITHUB_CLIENT_ID", "cid")
        env.setenv("IE_GITHUB_CLIENT_SECRET", "csecret")
        c = TestClient(create_app(), base_url="https://testserver")
        identity = {"id": 99, "login": "newbie", "email": "n@example.com", "created_at": "2015-01-01T00:00:00Z"}

        def sign_in():
            c.get("/v1/auth/github/login", follow_redirects=False)
            state = c.cookies.get("ie_oauth_state").split(".")[0]
            with patch("inference_exchange.coordinator.oauth_github._fetch_github_identity", return_value=identity):
                return c.get(f"/v1/auth/github/callback?code=c&state={state}", follow_redirects=False)

        assert "error=signup_disabled" in sign_in().headers["location"]
        # An existing GitHub identity can still sign in
        dependencies.get_store().upsert_github_user("99", "newbie", "n@example.com", "")
        assert sign_in().headers["location"] == "/chat"


class TestConcurrencyLimit:
    def test_extra_simultaneous_request_rejected(self, clients):
        admin, user, info = clients
        admin.post("/v1/admin/controls", json={"max_concurrent_per_account": 1})
        controls = get_controls()
        assert controls.try_acquire(info["user_id"])  # simulate one request in progress
        r = user.post("/v1/chat/completions", json=CHAT)
        assert r.status_code == 429 and r.json()["detail"]["type"] == "concurrency_limit"
        controls.release(info["user_id"])
        assert user.post("/v1/chat/completions", json=CHAT).status_code != 429

    def test_limit_is_per_account(self, clients):
        admin, user, _ = clients
        admin.post("/v1/admin/controls", json={"max_concurrent_per_account": 1})
        admin_id = admin.get("/v1/auth/me").json()["user_id"]
        get_controls().try_acquire(admin_id)
        assert user.post("/v1/chat/completions", json=CHAT).status_code != 429

    def test_slot_released_after_failed_request(self, clients):
        _admin, user, info = clients
        r = user.post("/v1/chat/completions", json=CHAT)  # no provider -> queue timeout
        assert r.status_code == 503
        assert get_controls().active_for(info["user_id"]) == 0

    def test_slot_released_after_stream(self):
        controls = get_controls()
        controls.max_concurrent_per_account = 1

        async def handler():
            async def gen():
                yield b"data: x\n\n"
            return StreamingResponse(gen())

        async def scenario():
            resp = await run_guarded("acct", handler)
            assert controls.active_for("acct") == 1
            async for _ in resp.body_iterator:
                pass
            assert controls.active_for("acct") == 0

        asyncio.run(scenario())

    def test_slot_released_on_plain_response_and_error(self):
        controls = get_controls()
        controls.max_concurrent_per_account = 1

        async def ok():
            return JSONResponse({})

        async def boom():
            raise RuntimeError("x")

        async def scenario():
            await run_guarded("acct2", ok)
            assert controls.active_for("acct2") == 0
            with pytest.raises(RuntimeError):
                await run_guarded("acct2", boom)
            assert controls.active_for("acct2") == 0

        asyncio.run(scenario())

    def test_run_guarded_rejects_when_paused_or_full(self):
        controls = get_controls()
        controls.max_concurrent_per_account = 1

        async def ok():
            return JSONResponse({})

        async def scenario():
            controls.try_acquire("acct3")
            with pytest.raises(ConcurrencyLimit):
                await run_guarded("acct3", ok)
            controls.release("acct3")
            controls.inference_paused = True
            with pytest.raises(InferencePaused):
                await run_guarded("acct3", ok)
            controls.inference_paused = False

        asyncio.run(scenario())


class TestQueueControls:
    def test_queue_settings_from_env(self, monkeypatch):
        monkeypatch.setenv("IE_QUEUE_MAX_DEPTH", "3")
        monkeypatch.setenv("IE_QUEUE_TIMEOUT_SECONDS", "7")
        hub = ProviderHub()
        assert hub.QUEUE_MAX_DEPTH == 3 and hub.QUEUE_TIMEOUT_SECONDS == 7.0
        for i in range(3):
            hub.enqueue_request(InferenceRequest(request_id=f"r{i}", model="m", messages=[]))
        with pytest.raises(asyncio.QueueFull):
            hub.enqueue_request(InferenceRequest(request_id="r4", model="m", messages=[]))

    def test_clear_queue_releases_waiters(self):
        hub = ProviderHub()
        pending = [hub.enqueue_request(InferenceRequest(request_id=f"r{i}", model="m", messages=[])) for i in range(2)]
        assert hub.clear_queue() == 2
        assert hub.pending_queue_size == 0
        assert all(p.cleared and p.event.is_set() for p in pending)

    def test_admin_controls_view(self, clients):
        admin, _user, _ = clients
        view = admin.get("/v1/admin/controls").json()
        assert {"inference_paused", "signup_disabled", "max_concurrent_per_account",
                "queue_length", "queue_max_depth", "active_requests_total"} <= set(view)
        assert admin.post("/v1/admin/queue/clear").json() == {"ok": True, "cleared": 0}


class TestControlsNeedAdmin:
    def test_non_admin_denied(self, clients):
        _admin, user, _ = clients
        assert user.get("/v1/admin/controls").status_code == 403
        assert user.post("/v1/admin/controls", json={"inference_paused": True}).status_code == 403
        assert user.post("/v1/admin/queue/clear").status_code == 403
        assert get_controls().inference_paused is False
