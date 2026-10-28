"""PROV-010: operators can revoke provider tokens and quarantine providers (#113)."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.provider_hub import ProviderHub
from inference_exchange.shared.protocol import (
    InferenceError,
    ProviderCapabilities,
    RegisterMessage,
)

ADMIN = "admin@example.com"


def _register_msg(name: str = "mini") -> dict:
    return RegisterMessage(provider_name=name, capabilities=ProviderCapabilities(models=["m"], hardware="apple-m6", model_format="gguf")).model_dump()


class FakeWS:
    def __init__(self):
        self.closed_with = None

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed_with = (code, reason)

    async def send_json(self, _data):
        pass


def _hub_with_provider(token_id: str = "tok1") -> tuple[ProviderHub, str, FakeWS]:
    hub = ProviderHub()
    ws = FakeWS()
    pid = hub.register_provider(ws, RegisterMessage(**_register_msg()))
    hub._providers[pid].token_id = token_id
    return hub, pid, ws


@pytest.fixture
def admin(monkeypatch):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("IE_PASSWORD_AUTH", "1")
    monkeypatch.setenv("IE_ADMIN_EMAILS", ADMIN)
    c = TestClient(create_app(), base_url="https://testserver")
    assert c.post("/v1/auth/signup", json={"email": ADMIN, "password": "hunter22"}).status_code == 200
    return c


class TestTokenRevocation:
    def test_revoked_token_refused_at_handshake(self, admin):
        token = admin.post("/v1/admin/provider-tokens", json={"name": "mini"}).json()["token"]
        token_id = admin.get("/v1/admin/provider-tokens").json()["tokens"][0]["token_id"]
        assert admin.delete(f"/v1/admin/provider-tokens/{token_id}").status_code == 200
        with pytest.raises(WebSocketDisconnect) as exc:
            with admin.websocket_connect(f"/ws/provider?token={token}") as ws:
                ws.receive_text()
        assert exc.value.code == 4003
        assert admin.get("/v1/admin/provider-tokens").json()["tokens"][0]["revoked_at"]

    def test_valid_token_records_token_id(self, admin):
        token = admin.post("/v1/admin/provider-tokens", json={"name": "mini"}).json()["token"]
        token_id = admin.get("/v1/admin/provider-tokens").json()["tokens"][0]["token_id"]
        with admin.websocket_connect(f"/ws/provider?token={token}") as ws:
            ws.send_json(_register_msg())
            pid = ws.receive_json()["provider_id"]
            assert dependencies.get_hub()._providers[pid].token_id == token_id

    def test_revoking_only_token_does_not_reopen_access(self, admin):
        admin.post("/v1/admin/provider-tokens", json={"name": "mini"})
        token_id = admin.get("/v1/admin/provider-tokens").json()["tokens"][0]["token_id"]
        admin.delete(f"/v1/admin/provider-tokens/{token_id}")
        with pytest.raises(WebSocketDisconnect) as exc:
            with admin.websocket_connect("/ws/provider") as ws:
                ws.receive_text()
        assert exc.value.code == 4003

    def test_revoke_disconnects_live_provider(self):
        hub, pid, ws = _hub_with_provider("tok1")
        queue = hub.create_response_queue("req-1")
        hub._request_to_provider["req-1"] = pid
        assert hub.providers_with_token("tok1") == [pid]
        assert asyncio.run(hub.force_disconnect(pid, "Provider token revoked"))
        assert pid not in hub._providers
        assert ws.closed_with == (4003, "Provider token revoked")
        msg = queue.get_nowait()
        assert isinstance(msg, InferenceError) and msg.error == "provider_disconnected"

    def test_unknown_token_404(self, admin):
        assert admin.delete("/v1/admin/provider-tokens/nope").status_code == 404


class TestQuarantine:
    def test_quarantined_provider_not_selected(self):
        hub, pid, _ = _hub_with_provider()
        assert hub.select_provider("m", min_confidence="open") is not None
        assert hub.set_quarantine(pid, True, "bad output")
        assert hub.select_provider("m", min_confidence="open") is None
        assert pid in hub._providers  # still connected
        hub.set_quarantine(pid, False)
        assert hub.select_provider("m", min_confidence="open").provider_id == pid

    def test_admin_quarantine_endpoint(self, admin):
        token = admin.post("/v1/admin/provider-tokens", json={"name": "quarantine-test"}).json()["token"]
        with admin.websocket_connect(f"/ws/provider?token={token}") as ws:
            ws.send_json(_register_msg())
            pid = ws.receive_json()["provider_id"]
            r = admin.post(f"/v1/admin/providers/{pid}/quarantine", json={"reason": "spam"})
            assert r.status_code == 200
            p = dependencies.get_hub()._providers[pid]
            assert p.quarantined and p.quarantine_reason == "spam"
            assert admin.post(f"/v1/admin/providers/{pid}/release").status_code == 200
            assert not p.quarantined

    def test_unknown_provider_404(self, admin):
        assert admin.post("/v1/admin/providers/provider-999/quarantine", json={}).status_code == 404


class TestProviderControlsNeedAdmin:
    def test_non_admin_denied(self, admin):
        user = TestClient(admin.app, base_url="https://testserver")
        user.post("/v1/auth/signup", json={"email": "u@example.com", "password": "hunter22"})
        assert user.delete("/v1/admin/provider-tokens/x").status_code == 403
        assert user.post("/v1/admin/providers/p/quarantine", json={}).status_code == 403
        assert user.post("/v1/admin/providers/p/release").status_code == 403
        assert user.post("/v1/admin/providers/p/disconnect").status_code == 403
