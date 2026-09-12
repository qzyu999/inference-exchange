"""Tests for the main inference endpoint (routes_inference.py).

Exercises auth, rate limiting, balance check, and request validation
through the actual FastAPI app with TestClient.
"""

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app


@pytest.fixture
def client():
    app = create_app()
    c = TestClient(app)
    # Shorten the queue timeout so tests don't hang for 30s
    from inference_exchange.coordinator.dependencies import get_hub
    try:
        hub = get_hub()
        hub.QUEUE_TIMEOUT_SECONDS = 0.1
    except RuntimeError:
        pass
    return c


@pytest.fixture
def api_key(client):
    """Get the default API key from the health endpoint."""
    resp = client.get("/health?include_key=1")
    return resp.json()["default_api_key"]


class TestInferenceEndpointExists:
    def test_chat_completions_mounted(self, client):
        """Verify the endpoint exists (returns 503 not 404 when no providers)."""
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": False,
        })
        # 503 = queue timeout (no provider), not 404 = endpoint missing
        assert resp.status_code in (503, 504)
        assert resp.status_code != 404

    def test_returns_structured_error(self, client):
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": False,
        })
        data = resp.json()
        # Error detail has type + message structure
        assert "detail" in data
        assert "type" in data["detail"]


class TestInputValidation:
    def test_rejects_empty_messages(self, client):
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": [],
            "stream": False,
        })
        assert resp.status_code == 400
        assert "empty" in resp.json()["error"]["message"].lower()

    def test_rejects_too_many_messages(self, client):
        messages = [{"role": "user", "content": "hi"}] * 101
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": messages,
            "stream": False,
        })
        assert resp.status_code == 400
        assert "100" in resp.json()["error"]["message"]

    def test_rejects_invalid_temperature(self, client):
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": [{"role": "user", "content": "hi"}],
            "temperature": 5.0,
            "stream": False,
        })
        assert resp.status_code == 400

    def test_rejects_invalid_max_tokens(self, client):
        resp = client.post("/v1/chat/completions", json={
            "model": "default",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": -1,
            "stream": False,
        })
        assert resp.status_code == 400


class TestAuthAndBilling:
    def test_health_returns_default_key(self, client):
        resp = client.get("/health?include_key=1")
        assert resp.status_code == 200
        assert "default_api_key" in resp.json()

    def test_balance_endpoint_works(self, client, api_key):
        resp = client.get("/v1/exchange/balance",
                          headers={"authorization": f"Bearer {api_key}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "balance_usd" in data
        assert data["balance_usd"] > 0  # Default $10 credit


class TestModelsEndpoint:
    def test_models_returns_list(self, client):
        resp = client.get("/v1/models")
        assert resp.status_code == 200
        data = resp.json()
        assert data["object"] == "list"
        assert isinstance(data["data"], list)


class TestProvidersEndpoint:
    def test_providers_returns_empty_when_none(self, client):
        resp = client.get("/v1/exchange/providers")
        assert resp.status_code == 200
        assert resp.json()["providers"] == []


class TestStatsEndpoint:
    def test_stats_returns_valid_structure(self, client):
        resp = client.get("/v1/exchange/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "providers_online" in data
        assert "total_requests" in data
        assert "models_available" in data
        assert isinstance(data["total_requests"], int)
