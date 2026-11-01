"""ROUTE-010/011: fail fast with a clear, OpenAI-shaped error when no provider can match (#114)."""

import time

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.provider_hub import ProviderHub
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage, TrustLevel


class FakeWS:
    async def send_json(self, _data):
        pass

    async def close(self, code: int = 1000, reason: str = ""):
        pass


def _add_provider(hub: ProviderHub, *, models=("qwen",), trust=TrustLevel.OPEN, price=0.2, slots=1) -> str:
    caps = ProviderCapabilities(models=list(models), trust_level=trust, price_per_mtok_output=price, max_concurrent=slots)
    return hub.register_provider(FakeWS(), RegisterMessage(provider_name="mini", capabilities=caps))


class TestExplainNoMatch:
    def test_no_providers(self):
        assert ProviderHub().explain_no_match("default")["code"] == "no_provider_available"

    def test_trust_mismatch_names_available_level(self):
        hub = ProviderHub()
        _add_provider(hub)
        result = hub.explain_no_match("default", min_confidence="hardened")
        assert result["code"] == "no_compatible_provider"
        assert "'open'" in result["message"] and "ocip_min_confidence" in result["message"]

    def test_unknown_model(self):
        hub = ProviderHub()
        _add_provider(hub, models=["qwen"])
        result = hub.explain_no_match("llama", min_confidence="open")
        assert result["code"] == "model_not_available" and "qwen" in result["message"]

    def test_price_ceiling(self):
        hub = ProviderHub()
        _add_provider(hub, price=1.0)
        result = hub.explain_no_match("default", min_confidence="open", max_price=0.1)
        assert result["code"] == "no_compatible_provider" and "ocip_max_price" in result["message"]

    def test_busy_compatible_provider_can_queue(self):
        hub = ProviderHub()
        pid = _add_provider(hub, slots=1)
        hub._providers[pid].active_requests = 1  # full
        assert hub.explain_no_match("default", min_confidence="open") is None

    def test_quarantined_provider_does_not_count(self):
        hub = ProviderHub()
        pid = _add_provider(hub)
        hub.set_quarantine(pid, True)
        assert hub.explain_no_match("default", min_confidence="open")["code"] == "no_provider_available"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_JWT_SECRET", "test-secret")
    return TestClient(create_app())


CHAT = {"model": "qwen", "messages": [{"role": "user", "content": "hi"}], "stream": False}


class TestEndpoint:
    def test_hardened_named_model_with_open_provider_fails_fast(self, client):
        hub = dependencies.get_hub()
        hub.QUEUE_TIMEOUT_SECONDS = 5.0  # a queued request would take this long
        _add_provider(hub)
        start = time.monotonic()
        r = client.post("/v1/chat/completions", json=CHAT)  # default ocip_min_confidence is hardened
        assert time.monotonic() - start < 1.0
        assert r.status_code == 503
        err = r.json()["error"]
        assert err["code"] == "no_compatible_provider"
        assert "ocip_min_confidence" in err["message"]

    def test_no_provider_fails_fast(self, client):
        dependencies.get_hub().QUEUE_TIMEOUT_SECONDS = 5.0
        start = time.monotonic()
        r = client.post("/v1/chat/completions", json=CHAT)
        assert time.monotonic() - start < 1.0
        assert r.json()["error"]["code"] == "no_provider_available"

    def test_trust_is_not_downgraded(self, client):
        hub = dependencies.get_hub()
        pid = _add_provider(hub)
        client.post("/v1/chat/completions", json={**CHAT, "ocip_min_confidence": "hardened"})
        assert hub._providers[pid].active_requests == 0


class TestOpenAIErrorShape:
    def test_ocip_errors_use_openai_shape(self, client):
        r = client.post("/v1/chat/completions", json=CHAT)
        body = r.json()
        assert "detail" not in body
        assert set(body["error"]) >= {"message", "type", "code"}

    def test_openai_sdk_reads_message(self, client):
        openai = pytest.importorskip("openai")
        import httpx

        transport = httpx.MockTransport(lambda req: httpx.Response(
            503, json=client.post("/v1/chat/completions", json=CHAT).json()))
        sdk = openai.OpenAI(api_key="sk-ie-x", base_url="http://test/v1", max_retries=0,
                            http_client=httpx.Client(transport=transport))
        with pytest.raises(openai.APIStatusError) as exc:
            sdk.chat.completions.create(model="qwen", messages=[{"role": "user", "content": "hi"}])
        assert "No provider is online" in str(exc.value)
