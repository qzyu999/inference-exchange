"""Tests for the confidential SDK transport and exchange client."""

import json

import json

import pytest

from inference_exchange.confidential_sdk import ConfidentialTransport, ExchangeClient


class TestConfidentialTransportInit:
    """ConfidentialTransport is an httpx.Client subclass."""

    def test_is_httpx_client(self):
        transport = ConfidentialTransport(api_key="sk-ie-test")
        assert hasattr(transport, "send")
        assert hasattr(transport, "_api_key")
        transport.close()

    def test_stores_api_key(self):
        transport = ConfidentialTransport(api_key="sk-ie-abc")
        assert transport._api_key == "sk-ie-abc"
        transport.close()

    def test_stores_base_url(self):
        transport = ConfidentialTransport(base_url="http://example.com:9000")
        assert transport._base_url == "http://example.com:9000"
        transport.close()

    def test_session_cache_starts_empty(self):
        transport = ConfidentialTransport()
        assert transport._session_cache is None
        transport.close()

    def test_fallback_config(self):
        transport = ConfidentialTransport(
            fallback_enabled=True,
            fallback_api_key="sk-openai-test",
            fallback_base_url="https://api.openai.com",
        )
        assert transport._fallback_enabled is True
        assert transport._fallback_api_key == "sk-openai-test"
        transport.close()


class TestExchangeClient:
    """ExchangeClient is a thin REST wrapper for marketplace endpoints."""

    def test_headers_include_auth(self):
        client = ExchangeClient(api_key="sk-ie-test")
        headers = client._headers()
        assert headers["authorization"] == "Bearer sk-ie-test"

    def test_headers_without_auth(self):
        client = ExchangeClient()
        headers = client._headers()
        assert "authorization" not in headers

    def test_base_url_default(self):
        client = ExchangeClient()
        assert client.base_url == "http://localhost:8000"

    def test_base_url_custom(self):
        client = ExchangeClient(base_url="http://coordinator:9000")
        assert client.base_url == "http://coordinator:9000"


class TestTransportRequestDetection:
    """The transport should only intercept POST to chat/completions."""

    def test_detects_chat_completions(self):
        import httpx
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/chat/completions",
                            content=json.dumps({"messages": []}).encode())
        assert transport._is_chat_completions(req) is True
        transport.close()

    def test_ignores_get_request(self):
        import httpx
        transport = ConfidentialTransport()
        req = httpx.Request("GET", "http://localhost:8000/v1/models")
        assert transport._is_chat_completions(req) is False
        transport.close()

    def test_ignores_other_post(self):
        import httpx
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/auth/keys",
                            content=json.dumps({"name": "test"}).encode())
        assert transport._is_chat_completions(req) is False
        transport.close()

    def test_ignores_empty_body(self):
        import httpx
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/chat/completions",
                            content=b"")
        assert transport._is_chat_completions(req) is False
        transport.close()
