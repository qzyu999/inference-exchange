"""Tests for OCIP spec alignment — protocol version, REGISTERED message,
structured errors, and encryption-key endpoint."""

import pytest
from fastapi import HTTPException

from inference_exchange.shared.protocol import (
    MessageType,
    ProviderCapabilities,
    RegisteredMessage,
    RegisterMessage,
    TrustLevel,
)
from inference_exchange.shared.errors import (
    ConfidenceUnavailable,
    InsufficientBalance,
    NoProviderAvailable,
    OCIPError,
    ProviderError,
    ProviderTimeout,
    QueueFull,
    QueueTimeout,
    RateLimitExceeded,
)


# --- Protocol version on RegisterMessage ---


class TestRegisterMessageProtocolVersion:
    def test_default_protocol_version(self):
        msg = RegisterMessage(
            provider_name="test-provider",
            capabilities=ProviderCapabilities(models=["llama-3"]),
        )
        assert msg.protocol_version == "0.1.0"

    def test_custom_protocol_version(self):
        msg = RegisterMessage(
            provider_name="test-provider",
            protocol_version="0.2.0",
            capabilities=ProviderCapabilities(models=["llama-3"]),
        )
        assert msg.protocol_version == "0.2.0"

    def test_protocol_version_in_serialized_output(self):
        msg = RegisterMessage(
            provider_name="test-provider",
            capabilities=ProviderCapabilities(models=["llama-3"]),
        )
        data = msg.model_dump()
        assert "protocol_version" in data
        assert data["protocol_version"] == "0.1.0"


# --- REGISTERED confirmation message ---


class TestRegisteredMessage:
    def test_message_type_enum(self):
        assert MessageType.REGISTERED == "registered"
        assert MessageType.REGISTERED.value == "registered"

    def test_default_fields(self):
        msg = RegisteredMessage(provider_id="p-123")
        assert msg.type == "registered"
        assert msg.provider_id == "p-123"
        assert msg.confidence_level == "open"
        assert msg.protocol_version == "0.1.0"

    def test_custom_confidence_level(self):
        msg = RegisteredMessage(
            provider_id="p-456",
            confidence_level="hardened",
        )
        assert msg.confidence_level == "hardened"

    def test_serialization_roundtrip(self):
        msg = RegisteredMessage(
            provider_id="p-789",
            confidence_level="confidential",
            protocol_version="0.1.0",
        )
        data = msg.model_dump()
        assert data["type"] == "registered"
        assert data["provider_id"] == "p-789"
        assert data["confidence_level"] == "confidential"
        assert data["protocol_version"] == "0.1.0"

        # Deserialize back
        restored = RegisteredMessage(**data)
        assert restored.provider_id == msg.provider_id
        assert restored.confidence_level == msg.confidence_level


# --- Structured OCIP error types ---


class TestOCIPErrors:
    def test_base_ocip_error(self):
        err = OCIPError(500, "test_error", "Something went wrong")
        assert err.status_code == 500
        assert err.detail == {"type": "test_error", "message": "Something went wrong"}
        assert isinstance(err, HTTPException)

    def test_no_provider_available(self):
        err = NoProviderAvailable()
        assert err.status_code == 503
        assert err.detail["type"] == "no_provider_available"
        assert "No provider available" in err.detail["message"]

    def test_no_provider_available_custom_message(self):
        err = NoProviderAvailable("Model X is not served by anyone")
        assert err.status_code == 503
        assert err.detail["message"] == "Model X is not served by anyone"

    def test_confidence_unavailable(self):
        err = ConfidenceUnavailable("hardened", "llama-3")
        assert err.status_code == 503
        assert err.detail["type"] == "confidence_unavailable"
        assert "hardened" in err.detail["message"]
        assert "llama-3" in err.detail["message"]

    def test_insufficient_balance(self):
        err = InsufficientBalance()
        assert err.status_code == 402
        assert err.detail["type"] == "insufficient_balance"

    def test_provider_timeout(self):
        err = ProviderTimeout()
        assert err.status_code == 504
        assert err.detail["type"] == "provider_timeout"

    def test_provider_error(self):
        err = ProviderError("GPU out of memory")
        assert err.status_code == 502
        assert err.detail["type"] == "provider_error"
        assert err.detail["message"] == "GPU out of memory"

    def test_provider_error_default_message(self):
        err = ProviderError()
        assert err.detail["message"] == "Provider returned an error"

    def test_queue_full(self):
        err = QueueFull(50)
        assert err.status_code == 503
        assert err.detail["type"] == "queue_full"
        assert "50" in err.detail["message"]

    def test_queue_timeout(self):
        err = QueueTimeout(120.0)
        assert err.status_code == 503
        assert err.detail["type"] == "queue_timeout"
        assert "120" in err.detail["message"]

    def test_rate_limit_exceeded(self):
        err = RateLimitExceeded()
        assert err.status_code == 429
        assert err.detail["type"] == "rate_limit_exceeded"


# --- Encryption key endpoint ---


class TestEncryptionKeyEndpoint:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from inference_exchange.coordinator.main import create_app

        app = create_app()
        return TestClient(app)

    def test_encryption_key_returns_expected_shape(self, client):
        resp = client.get("/v1/encryption-key")
        assert resp.status_code == 200
        data = resp.json()
        assert data["mode"] == "provider-direct"
        assert "algorithm" in data
        assert data["algorithm"] == "x25519-xsalsa20-poly1305"
        assert "note" in data
