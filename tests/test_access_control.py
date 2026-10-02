"""Access control on coordinator endpoints, in dev and prod mode."""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.event_bus import public_event
from inference_exchange.coordinator.main import create_app


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    def _make(env: str = "dev", admin_emails: str = ""):
        monkeypatch.setenv("IE_DB_PATH", str(tmp_path / f"{env}.db"))
        monkeypatch.setenv("IE_ENV", env)
        monkeypatch.setenv("IE_ADMIN_EMAILS", admin_emails)
        monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
        dependencies._request_traces.clear()
        return TestClient(create_app())
    return _make


def signup(client: TestClient, email: str) -> TestClient:
    r = client.post("/v1/auth/signup", json={"email": email, "password": "hunter22"})
    assert r.status_code == 200, r.text
    return client


class TestProdMode:
    def test_requires_jwt_secret(self, tmp_path, monkeypatch):
        monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "x.db"))
        monkeypatch.setenv("IE_ENV", "prod")
        monkeypatch.delenv("IE_JWT_SECRET", raising=False)
        with pytest.raises(RuntimeError, match="IE_JWT_SECRET"):
            create_app()

    def test_health_hides_default_key(self, make_client):
        c = make_client("prod")
        assert "default_api_key" not in c.get("/health?include_key=1").json()

    def test_anonymous_key_creation_rejected(self, make_client):
        c = make_client("prod")
        assert c.post("/v1/auth/keys", json={"name": "x"}).status_code == 401

    def test_anonymous_reset_balance_rejected(self, make_client):
        c = make_client("prod")
        assert c.post("/v1/auth/reset-balance").status_code == 401

    def test_admin_endpoints_need_admin_even_with_no_users(self, make_client):
        c = make_client("prod")
        assert c.get("/v1/admin/state").status_code == 403
        assert c.get("/v1/admin/provider-tokens").status_code == 403
        assert c.post("/v1/admin/provider-tokens", json={"name": "p"}).status_code == 403
        assert c.get("/v1/exchange/provider-earnings").status_code == 403


class TestKeysAndAdmin:
    def test_anonymous_key_list_is_empty(self, make_client):
        c = make_client()
        signup(c, "a@example.com")
        c.cookies.clear()
        assert c.get("/v1/auth/keys").json() == {"keys": []}

    def test_user_sees_only_own_keys(self, make_client):
        c = make_client()
        signup(c, "a@example.com")
        keys = c.get("/v1/auth/keys").json()["keys"]
        assert len(keys) == 1

    def test_non_admin_user_gets_403(self, make_client):
        c = make_client()
        signup(c, "user@example.com")
        assert c.get("/v1/admin/state").status_code == 403
        assert c.post("/v1/admin/provider-tokens", json={"name": "p"}).status_code == 403

    def test_admin_email_gets_admin_role(self, make_client):
        c = make_client(admin_emails="boss@example.com")
        signup(c, "boss@example.com")
        assert c.get("/v1/admin/state").status_code == 200
        r = c.post("/v1/admin/provider-tokens", json={"name": "p"})
        assert r.status_code == 200 and r.json()["token"]

    def test_dev_mode_open_before_first_user(self, make_client):
        c = make_client()
        assert c.get("/v1/admin/state").status_code == 200


class TestProviderTokens:
    def test_provider_without_token_rejected_once_tokens_exist(self, make_client):
        from starlette.websockets import WebSocketDisconnect
        c = make_client()
        dependencies.get_store().create_provider_token("p")
        with pytest.raises(WebSocketDisconnect) as exc:
            with c.websocket_connect("/ws/provider") as ws:
                ws.receive_text()
        assert exc.value.code == 4003


class TestTraceAndEventPrivacy:
    def test_traces_scoped_to_caller(self, make_client):
        c = make_client()
        dependencies._add_trace({"request_id": "aaaa", "status": "matched"}, "user-a")
        dependencies._add_trace({"request_id": "bbbb", "status": "matched"}, "user-b")
        signup(c, "x@example.com")  # now users exist, so dev admin bypass is off
        traces = c.get("/v1/exchange/traces").json()["traces"]
        assert traces == []

    def test_trace_owner_field_not_exposed(self, make_client):
        c = make_client(admin_emails="boss@example.com")
        dependencies._add_trace({"request_id": "aaaa"}, "user-a")
        signup(c, "boss@example.com")
        traces = c.get("/v1/exchange/traces").json()["traces"]
        assert traces and all(dependencies.TRACE_OWNER_KEY not in t for t in traces)

    def test_unverified_trust_is_labelled_self_reported(self):
        from types import SimpleNamespace
        from inference_exchange.coordinator.routes_exchange import trust_record
        p = SimpleNamespace(capabilities=SimpleNamespace(trust_level=SimpleNamespace(value="hardened")), verified_trust_level=None)
        assert trust_record(p) == {"claimed": "hardened", "verified": None, "basis": "self_reported"}

    def test_public_event_strips_identifiers(self):
        ev = {"type": "billing", "consumer_id": "u", "request_id": "r", "provider": "p", "cost_usd": 0.1}
        assert public_event(ev) == {"type": "billing", "provider": "p", "cost_usd": 0.1}
