"""PROV-011 (#125): provider credentials stay out of URLs and logs."""

import asyncio
import logging
import threading

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.config import ProviderConfig
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import Store
from inference_exchange.provider.agent import ProviderAgent
from inference_exchange.provider.mock_engine import MockEngine
from inference_exchange.shared import provider_auth
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage
from inference_exchange.shared.provider_auth import RedactSecretsFilter, redact, split_token_from_url

from test_mock_provider_e2e import Coordinator, _free_port, _wait


def _register() -> dict:
    return RegisterMessage(
        provider_name="transport-test",
        capabilities=ProviderCapabilities(models=["test-model"], hardware="apple-m6", model_format="gguf"),
    ).model_dump()


@pytest.fixture
def prod_client(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "transport-test-secret")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "transport.db"))
    return TestClient(create_app(), base_url="https://testserver")


class TestHeaderAuth:
    def test_bearer_header_registers(self, prod_client):
        token = Store().create_provider_token("hdr")
        with prod_client.websocket_connect("/ws/provider", headers={"Authorization": f"Bearer {token}"}) as ws:
            ws.send_json(_register())
            assert ws.receive_json()["type"] == "registered"

    @pytest.mark.parametrize("header", ["Bearer pt-ie-unknown", "Bearer ", "Basic abc", "pt-ie-nobearer"])
    def test_bad_header_rejected(self, prod_client, header):
        Store().create_provider_token("hdr")
        with pytest.raises(WebSocketDisconnect) as exc:
            with prod_client.websocket_connect("/ws/provider", headers={"Authorization": header}) as ws:
                ws.receive_text()
        assert exc.value.code == 4003

    def test_revoked_token_in_header_rejected(self, prod_client):
        store = Store()
        token = store.create_provider_token("hdr")
        store.revoke_provider_token(store.list_provider_tokens()[0]["token_id"])
        with pytest.raises(WebSocketDisconnect) as exc:
            with prod_client.websocket_connect("/ws/provider", headers={"Authorization": f"Bearer {token}"}) as ws:
                ws.receive_text()
        assert exc.value.code == 4003

    def test_self_reported_name_is_not_a_credential(self, prod_client):
        Store().create_provider_token("transport-test")
        with pytest.raises(WebSocketDisconnect) as exc:
            with prod_client.websocket_connect("/ws/provider") as ws:
                ws.send_json(_register())
                ws.receive_text()
        assert exc.value.code == 4003


class TestUrlFallback:
    def test_legacy_url_token_still_works_and_warns_without_secret(self, prod_client, caplog):
        token = Store().create_provider_token("legacy")
        with caplog.at_level(logging.INFO):
            with prod_client.websocket_connect(f"/ws/provider?token={token}") as ws:
                ws.send_json(_register())
                assert ws.receive_json()["type"] == "registered"
        assert "deprecated ?token=" in caplog.text
        assert token not in caplog.text

    def test_url_token_can_be_disabled(self, prod_client, monkeypatch):
        token = Store().create_provider_token("legacy")
        monkeypatch.setenv("IE_PROVIDER_URL_TOKEN", "0")
        with pytest.raises(WebSocketDisconnect) as exc:
            with prod_client.websocket_connect(f"/ws/provider?token={token}") as ws:
                ws.receive_text()
        assert exc.value.code == 4003


class TestRedaction:
    def test_redact_query_and_known_prefixes(self):
        line = 'GET /ws/provider?token=pt-ie-abc123&x=1 key sk-ie-zzz "Bearer pt-ie-def"'
        out = redact(line)
        assert "abc123" not in out and "zzz" not in out and "def" not in out
        assert "x=1" in out

    def test_filter_rewrites_formatted_record(self):
        record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1,
                                   '%s - "%s %s"', ("127.0.0.1", "GET", "/ws/provider?token=pt-ie-secret1"), None)
        RedactSecretsFilter().filter(record)
        assert "pt-ie-secret1" not in record.getMessage()

    def test_actual_uvicorn_access_formatter_handles_redacted_url(self):
        # Regression: AccessFormatter unpacks five structured arguments after
        # the logging filter runs, so redaction must preserve their shape.
        from uvicorn.logging import AccessFormatter

        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:3456", "GET", "/health?token=pt-ie-secret", "1.1", 200),
            None,
        )
        RedactSecretsFilter().filter(record)
        formatted = AccessFormatter(use_colors=False).format(record)
        assert "pt-ie-secret" not in formatted
        assert "token=[REDACTED]" in formatted
        assert "GET" in formatted and "200" in formatted

    def test_uvicorn_log_config_filters_every_handler(self):
        cfg = provider_auth.uvicorn_log_config()
        assert all("redact_secrets" in h["filters"] for h in cfg["handlers"].values())

    def test_split_token_from_url(self):
        clean, token = split_token_from_url("wss://h/ws/provider?a=1&token=pt-ie-x")
        assert token == "pt-ie-x" and clean == "wss://h/ws/provider?a=1"


class TestAgentSendsHeader:
    def test_agent_connects_with_header_and_url_has_no_token(self, monkeypatch, caplog):
        """Real WebSocket: the agent authenticates, and nothing logs the token."""
        monkeypatch.setenv("IE_ENV", "dev")
        coord = Coordinator(_free_port())
        coord.start()
        token = Store().create_provider_token("agent")  # tokens exist -> token required

        seen_urls: list[str] = []
        import websockets
        orig = websockets.connect

        def spy(url, **kw):
            seen_urls.append(url)
            return orig(url, **kw)

        monkeypatch.setattr(websockets, "connect", spy)
        agent = ProviderAgent(
            ProviderConfig(coordinator_url=f"ws://127.0.0.1:{coord.port}/ws/provider?token={token}",
                           provider_name="agent", provider_token=""),
            MockEngine(model_name="mock-model", tps=0),
        )
        loop = asyncio.new_event_loop()
        with caplog.at_level(logging.INFO):
            threading.Thread(target=loop.run_until_complete, args=(agent.run(),), daemon=True).start()
            try:
                assert _wait(lambda: coord.provider_count() == 1)
            finally:
                agent._running = False
                coord.stop()
        assert seen_urls and all("token" not in u for u in seen_urls)
        assert token not in caplog.text
