"""Tests for the confidential SDK transport and exchange client."""

import json

import httpx
import pytest

from inference_exchange.confidential_sdk import ConfidentialTransport, ExchangeClient


class TestConfidentialTransportInit:

    def test_is_httpx_client(self):
        transport = ConfidentialTransport(api_key="sk-ie-test")
        assert hasattr(transport, "send")
        transport.close()

    def test_stores_api_key(self):
        transport = ConfidentialTransport(api_key="sk-ie-abc")
        assert transport._api_key == "sk-ie-abc"
        transport.close()

    def test_stores_base_url(self):
        transport = ConfidentialTransport(base_url="http://example.com:9000")
        assert transport._base_url == "http://example.com:9000"
        transport.close()

    def test_generates_keypair(self):
        transport = ConfidentialTransport()
        assert transport.public_key_b64
        assert len(transport.public_key_b64) > 20
        transport.close()

    def test_generates_session_id(self):
        transport = ConfidentialTransport()
        assert transport._session_id
        transport.close()

    def test_sequence_starts_at_zero(self):
        transport = ConfidentialTransport()
        assert transport._sequence == 0
        transport.close()

    def test_fallback_config(self):
        transport = ConfidentialTransport(
            fallback_enabled=True,
            fallback_api_key="sk-openai-test",
        )
        assert transport._fallback_enabled is True
        transport.close()

    def test_two_transports_have_different_keys(self):
        t1 = ConfidentialTransport()
        t2 = ConfidentialTransport()
        assert t1.public_key_b64 != t2.public_key_b64
        t1.close()
        t2.close()


class TestExchangeClient:

    def test_headers_include_auth(self):
        client = ExchangeClient(api_key="sk-ie-test")
        assert client._headers()["authorization"] == "Bearer sk-ie-test"

    def test_headers_without_auth(self):
        assert "authorization" not in ExchangeClient()._headers()

    def test_base_url_default(self):
        assert ExchangeClient().base_url == "http://localhost:8000"


class TestTransportRequestDetection:

    def test_detects_chat_completions(self):
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/chat/completions",
                            content=json.dumps({"messages": []}).encode())
        assert transport._is_chat_completions(req) is True
        transport.close()

    def test_ignores_get_request(self):
        transport = ConfidentialTransport()
        req = httpx.Request("GET", "http://localhost:8000/v1/models")
        assert transport._is_chat_completions(req) is False
        transport.close()

    def test_ignores_other_post(self):
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/auth/keys",
                            content=json.dumps({"name": "test"}).encode())
        assert transport._is_chat_completions(req) is False
        transport.close()

    def test_ignores_empty_body(self):
        transport = ConfidentialTransport()
        req = httpx.Request("POST", "http://localhost:8000/v1/chat/completions",
                            content=b"")
        assert transport._is_chat_completions(req) is False
        transport.close()


class TestResponseDecryption:
    """Verify the transport can decrypt NaCl Box encrypted responses."""

    def test_decrypt_non_streaming_with_encrypted_tokens(self):
        from inference_exchange.shared.crypto import encrypt_to_recipient

        transport = ConfidentialTransport()
        consumer_pubkey = transport.public_key_b64

        enc1 = encrypt_to_recipient("Hello", consumer_pubkey)
        enc2 = encrypt_to_recipient(" world", consumer_pubkey)

        fake_response = httpx.Response(
            status_code=200,
            headers={"content-type": "application/json"},
            content=json.dumps({
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "model": "test",
                "ocip_encrypted_tokens": [enc1.to_dict(), enc2.to_dict()],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            }).encode(),
        )

        decrypted = transport._decrypt_response(fake_response)
        data = json.loads(decrypted.content)
        assert data["choices"][0]["message"]["content"] == "Hello world"
        assert "ocip_encrypted_tokens" not in data
        transport.close()

    def test_decrypt_passes_through_non_encrypted(self):
        transport = ConfidentialTransport()
        fake_response = httpx.Response(
            status_code=200,
            headers={"content-type": "application/json"},
            content=json.dumps({
                "id": "chatcmpl-test",
                "choices": [{"message": {"role": "assistant", "content": "plain"}}],
            }).encode(),
        )
        result = transport._decrypt_response(fake_response)
        data = json.loads(result.content)
        assert data["choices"][0]["message"]["content"] == "plain"
        transport.close()

    def test_decrypt_passes_through_errors(self):
        transport = ConfidentialTransport()
        fake_response = httpx.Response(status_code=503, content=b'{"error":"no provider"}')
        result = transport._decrypt_response(fake_response)
        assert result.status_code == 503
        transport.close()
