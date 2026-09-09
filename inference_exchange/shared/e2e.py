"""Authenticated end-to-end inference session primitives.

This module is deliberately transport-agnostic. It provides the cryptographic
building blocks for #21; coordinator routing is responsible only for relaying
public handshake material and ciphertext.

Construction:
    provider identity: Ed25519 (long-lived authentication key)
    session agreement: X25519 (fresh ephemeral keypairs)
    key derivation: HKDF-SHA256
    message protection: AES-256-GCM

The provider identity key is distinct from the App Attest key and from the
per-session X25519 keys. Private keys are never serialized by this module.
"""

from __future__ import annotations

import base64
import hashlib
import struct
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


PROTOCOL_VERSION = "0.1.0"
_INFO_PREFIX = b"inference-exchange/e2e/v1"
_NONCE_SIZE = 12
_KEY_SIZE = 32
_MAX_CIPHERTEXT = 16 * 1024 * 1024


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def _transcript(
    session_id: str,
    provider_id: str,
    provider_identity_public_key: bytes,
    provider_ephemeral_public_key: bytes,
    consumer_ephemeral_public_key: bytes,
    admission_id: str,
) -> bytes:
    """Canonical length-prefixed handshake transcript."""
    fields = [
        PROTOCOL_VERSION.encode("ascii"),
        session_id.encode("utf-8"),
        provider_id.encode("utf-8"),
        provider_identity_public_key,
        provider_ephemeral_public_key,
        consumer_ephemeral_public_key,
        admission_id.encode("utf-8"),
    ]
    return b"".join(struct.pack("!I", len(v)) + v for v in fields)


@dataclass(frozen=True)
class ProviderIdentity:
    """Long-lived provider authentication identity.

    Storage/lifecycle of the private key belongs to the native provider
    implementation. This object intentionally exposes only the public key in
    wire-facing APIs.
    """

    private_key: Ed25519PrivateKey

    @classmethod
    def generate(cls) -> "ProviderIdentity":
        return cls(Ed25519PrivateKey.generate())

    @property
    def public_key(self) -> bytes:
        return self.private_key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )

    @property
    def public_key_b64(self) -> str:
        return _b64(self.public_key)

    def sign(self, transcript: bytes) -> bytes:
        return self.private_key.sign(transcript)


@dataclass(frozen=True)
class SessionKeys:
    """Directional AEAD keys for one session."""

    send_key: bytes
    receive_key: bytes


@dataclass(frozen=True)
class EncryptedMessage:
    """Wire envelope for one authenticated ciphertext."""

    session_id: str
    sequence_number: int
    nonce: str
    ciphertext: str

    def to_dict(self) -> dict:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "session_id": self.session_id,
            "sequence_number": self.sequence_number,
            "nonce": self.nonce,
            "ciphertext": self.ciphertext,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EncryptedMessage":
        if data.get("protocol_version") != PROTOCOL_VERSION:
            raise ValueError("unsupported E2E protocol version")
        sequence = data.get("sequence_number")
        if not isinstance(sequence, int) or sequence < 0:
            raise ValueError("invalid sequence number")
        return cls(
            session_id=str(data["session_id"]),
            sequence_number=sequence,
            nonce=str(data["nonce"]),
            ciphertext=str(data["ciphertext"]),
        )


class E2ESession:
    """One side of an authenticated ephemeral-DH inference session."""

    def __init__(self, session_id: str, keys: SessionKeys):
        if not session_id:
            raise ValueError("session_id is required")
        self.session_id = session_id
        self._keys = keys
        self._send_sequence = 0
        self._last_received_sequence = -1

    @classmethod
    def derive(
        cls,
        *,
        session_id: str,
        shared_secret: bytes,
        transcript: bytes,
        is_consumer: bool,
    ) -> "E2ESession":
        if len(shared_secret) != 32:
            raise ValueError("X25519 shared secret must be 32 bytes")
        salt = hashlib.sha256(transcript).digest()
        material = HKDF(
            algorithm=hashes.SHA256(),
            length=64,
            salt=salt,
            info=_INFO_PREFIX + b"/" + hashlib.sha256(transcript).digest(),
        ).derive(shared_secret)
        consumer_to_provider = material[:_KEY_SIZE]
        provider_to_consumer = material[_KEY_SIZE:]
        if is_consumer:
            return cls(session_id, SessionKeys(consumer_to_provider, provider_to_consumer))
        return cls(session_id, SessionKeys(provider_to_consumer, consumer_to_provider))

    def encrypt(self, plaintext: bytes, *, associated_data: bytes = b"") -> EncryptedMessage:
        if len(plaintext) > _MAX_CIPHERTEXT:
            raise ValueError("plaintext too large")
        sequence = self._send_sequence
        self._send_sequence += 1
        nonce = sequence.to_bytes(8, "big") + __import__("secrets").token_bytes(4)
        aad = self._aad(sequence, associated_data)
        ciphertext = AESGCM(self._keys.send_key).encrypt(nonce, plaintext, aad)
        return EncryptedMessage(
            session_id=self.session_id,
            sequence_number=sequence,
            nonce=_b64(nonce),
            ciphertext=_b64(ciphertext),
        )

    def decrypt(self, message: EncryptedMessage, *, associated_data: bytes = b"") -> bytes:
        if message.session_id != self.session_id:
            raise ValueError("session ID mismatch")
        if message.sequence_number <= self._last_received_sequence:
            raise ValueError("replayed or out-of-order message")
        nonce = _unb64(message.nonce)
        ciphertext = _unb64(message.ciphertext)
        if len(nonce) != _NONCE_SIZE:
            raise ValueError("invalid AEAD nonce")
        if len(ciphertext) > _MAX_CIPHERTEXT + 16:
            raise ValueError("ciphertext too large")
        aad = self._aad(message.sequence_number, associated_data)
        plaintext = AESGCM(self._keys.receive_key).decrypt(nonce, ciphertext, aad)
        self._last_received_sequence = message.sequence_number
        return plaintext

    def _aad(self, sequence: int, associated_data: bytes) -> bytes:
        return (
            PROTOCOL_VERSION.encode("ascii")
            + b"|"
            + self.session_id.encode("utf-8")
            + b"|"
            + sequence.to_bytes(8, "big")
            + b"|"
            + associated_data
        )


def generate_ephemeral_keypair() -> X25519PrivateKey:
    """Generate a fresh X25519 private key for one session."""
    return X25519PrivateKey.generate()


def ephemeral_public_bytes(private_key: X25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )


def derive_session(
    *,
    private_key: X25519PrivateKey,
    peer_public_key: bytes,
    session_id: str,
    provider_id: str,
    provider_identity_public_key: bytes,
    provider_ephemeral_public_key: bytes,
    consumer_ephemeral_public_key: bytes,
    admission_id: str,
    is_consumer: bool,
) -> E2ESession:
    """Derive a session after the provider handshake has been authenticated."""
    peer = X25519PublicKey.from_public_bytes(peer_public_key)
    shared_secret = private_key.exchange(peer)
    transcript = _transcript(
        session_id,
        provider_id,
        provider_identity_public_key,
        provider_ephemeral_public_key,
        consumer_ephemeral_public_key,
        admission_id,
    )
    return E2ESession.derive(
        session_id=session_id,
        shared_secret=shared_secret,
        transcript=transcript,
        is_consumer=is_consumer,
    )


def sign_handshake(
    identity: ProviderIdentity,
    *,
    session_id: str,
    provider_id: str,
    provider_ephemeral_public_key: bytes,
    consumer_ephemeral_public_key: bytes,
    admission_id: str,
) -> str:
    transcript = _transcript(
        session_id,
        provider_id,
        identity.public_key,
        provider_ephemeral_public_key,
        consumer_ephemeral_public_key,
        admission_id,
    )
    return _b64(identity.sign(transcript))


def verify_handshake(
    signature_b64: str,
    provider_identity_public_key: bytes,
    *,
    session_id: str,
    provider_id: str,
    provider_ephemeral_public_key: bytes,
    consumer_ephemeral_public_key: bytes,
    admission_id: str,
) -> None:
    transcript = _transcript(
        session_id,
        provider_id,
        provider_identity_public_key,
        provider_ephemeral_public_key,
        consumer_ephemeral_public_key,
        admission_id,
    )
    try:
        Ed25519PublicKey.from_public_bytes(provider_identity_public_key).verify(
            _unb64(signature_b64), transcript
        )
    except (InvalidSignature, ValueError) as exc:
        raise ValueError("invalid provider handshake signature") from exc
