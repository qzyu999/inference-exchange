"""Authenticated provider offers and session-handshake transcript helpers."""

from __future__ import annotations

import base64
import secrets
import time
from dataclasses import dataclass

PROTOCOL_VERSION = "0.1.0"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("expected non-empty base64 string")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class ProviderOffer:
    """Authenticated admission record exposed to consumers."""
    provider_id: str
    provider_identity_public_key: str
    app_attest_key_id: str
    security_profile: str
    protocol_version: str
    models: tuple[str, ...]
    expires_at: int
    admission_id: str
    artifact_or_build_hash: str

    def validate(self, *, now: int | None = None) -> None:
        if not self.provider_id or not self.provider_identity_public_key:
            raise ValueError("incomplete provider identity")
        if not self.app_attest_key_id:
            raise ValueError("missing App Attest key id")
        if self.security_profile != "L2":
            raise ValueError("provider is not admitted at L2")
        if self.protocol_version != PROTOCOL_VERSION:
            raise ValueError("unsupported protocol version")
        if not self.models:
            raise ValueError("provider advertises no models")
        if not self.admission_id or not self.artifact_or_build_hash:
            raise ValueError("incomplete admission record")
        current = int(time.time()) if now is None else now
        if self.expires_at <= current:
            raise ValueError("provider admission has expired")
        _unb64(self.provider_identity_public_key)

    def to_dict(self) -> dict:
        return {
            "provider_id": self.provider_id,
            "provider_identity_public_key": self.provider_identity_public_key,
            "app_attest_key_id": self.app_attest_key_id,
            "security_profile": self.security_profile,
            "protocol_version": self.protocol_version,
            "models": list(self.models),
            "expires_at": self.expires_at,
            "admission_id": self.admission_id,
            "artifact_or_build_hash": self.artifact_or_build_hash,
        }


@dataclass(frozen=True)
class HandshakeParameters:
    session_id: str
    provider_id: str
    admission_id: str
    provider_identity_public_key: bytes
    provider_ephemeral_public_key: bytes
    consumer_ephemeral_public_key: bytes
    freshness: bytes
    protocol_version: str = PROTOCOL_VERSION

    def transcript(self) -> bytes:
        fields = (
            self.protocol_version.encode("ascii"),
            self.session_id.encode("utf-8"),
            self.provider_id.encode("utf-8"),
            self.admission_id.encode("utf-8"),
            self.provider_identity_public_key,
            self.provider_ephemeral_public_key,
            self.consumer_ephemeral_public_key,
            self.freshness,
        )
        return b"".join(len(value).to_bytes(4, "big") + value for value in fields)


@dataclass(frozen=True)
class SessionHello:
    """Consumer handshake request. The coordinator can relay it verbatim."""
    session_id: str
    provider_id: str
    admission_id: str
    consumer_ephemeral_public_key: str
    freshness: str
    protocol_version: str = PROTOCOL_VERSION

    @classmethod
    def create(cls, provider: ProviderOffer) -> tuple["SessionHello", bytes]:
        provider.validate()
        session_id = secrets.token_urlsafe(24)
        freshness = secrets.token_bytes(32)
        return cls(
            session_id=session_id,
            provider_id=provider.provider_id,
            admission_id=provider.admission_id,
            consumer_ephemeral_public_key="",
            freshness=_b64(freshness),
        ), freshness

    def to_dict(self) -> dict:
        return {
            "type": "session_hello",
            "protocol_version": self.protocol_version,
            "session_id": self.session_id,
            "provider_id": self.provider_id,
            "admission_id": self.admission_id,
            "consumer_ephemeral_public_key": self.consumer_ephemeral_public_key,
            "freshness": self.freshness,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SessionHello":
        if data.get("type") != "session_hello":
            raise ValueError("unexpected handshake message type")
        result = cls(
            session_id=data.get("session_id", ""),
            provider_id=data.get("provider_id", ""),
            admission_id=data.get("admission_id", ""),
            consumer_ephemeral_public_key=data.get("consumer_ephemeral_public_key", ""),
            freshness=data.get("freshness", ""),
            protocol_version=data.get("protocol_version", ""),
        )
        if result.protocol_version != PROTOCOL_VERSION:
            raise ValueError("unsupported protocol version")
        if not result.session_id or not result.provider_id or not result.admission_id:
            raise ValueError("incomplete session hello")
        _unb64(result.consumer_ephemeral_public_key)
        freshness = _unb64(result.freshness)
        if len(freshness) != 32:
            raise ValueError("invalid freshness value")
        return result


def build_transcript(*, session_id: str, provider: ProviderOffer,
                     provider_ephemeral_public_key: bytes,
                     consumer_ephemeral_public_key: bytes,
                     freshness: bytes) -> bytes:
    provider.validate()
    if len(provider_ephemeral_public_key) != 32 or len(consumer_ephemeral_public_key) != 32:
        raise ValueError("X25519 public keys must be 32 bytes")
    if len(freshness) != 32:
        raise ValueError("freshness must be 32 bytes")
    return HandshakeParameters(
        session_id=session_id,
        provider_id=provider.provider_id,
        admission_id=provider.admission_id,
        provider_identity_public_key=_unb64(provider.provider_identity_public_key),
        provider_ephemeral_public_key=provider_ephemeral_public_key,
        consumer_ephemeral_public_key=consumer_ephemeral_public_key,
        freshness=freshness,
        protocol_version=provider.protocol_version,
    ).transcript()
