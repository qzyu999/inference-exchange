"""Authenticated end-to-end inference session primitives."""

from __future__ import annotations

import base64
import hashlib
import secrets
import struct
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PROTOCOL_VERSION = "0.1.0"
_INFO_PREFIX = b"inference-exchange/e2e/v1"
_NONCE_SIZE = 12
_KEY_SIZE = 32
_MAX_CIPHERTEXT = 16 * 1024 * 1024
_MAX_SESSION_ID = 256


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def _transcript(session_id: str, provider_id: str, provider_identity_public_key: bytes,
                provider_ephemeral_public_key: bytes, consumer_ephemeral_public_key: bytes,
                admission_id: str, freshness: bytes) -> bytes:
    """Canonical length-prefixed handshake transcript."""
    if not session_id or len(session_id) > _MAX_SESSION_ID:
        raise ValueError("invalid session ID")
    if len(provider_identity_public_key) != 32:
        raise ValueError("provider identity key must be 32 bytes")
    if len(provider_ephemeral_public_key) != 32 or len(consumer_ephemeral_public_key) != 32:
        raise ValueError("ephemeral public keys must be 32 bytes")
    if len(freshness) < 16 or len(freshness) > 64:
        raise ValueError("invalid handshake freshness")
    fields = [PROTOCOL_VERSION.encode("ascii"), session_id.encode("utf-8"), provider_id.encode("utf-8"),
              provider_identity_public_key, provider_ephemeral_public_key, consumer_ephemeral_public_key,
              admission_id.encode("utf-8"), freshness]
    return b"".join(struct.pack("!I", len(value)) + value for value in fields)


@dataclass(frozen=True)
class ProviderIdentity:
    private_key: Ed25519PrivateKey

    @classmethod
    def generate(cls) -> "ProviderIdentity":
        return cls(Ed25519PrivateKey.generate())

    @property
    def public_key(self) -> bytes:
        return self.private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    @property
    def public_key_b64(self) -> str:
        return _b64(self.public_key)

    def sign(self, transcript: bytes) -> bytes:
        return self.private_key.sign(transcript)


@dataclass(frozen=True)
class SessionKeys:
    send_key: bytes
    receive_key: bytes


@dataclass(frozen=True)
class EncryptedMessage:
    session_id: str
    direction: str
    sequence_number: int
    nonce: str
    ciphertext: str

    def to_dict(self) -> dict:
        return {"protocol_version": PROTOCOL_VERSION, "session_id": self.session_id,
                "direction": self.direction, "sequence_number": self.sequence_number,
                "nonce": self.nonce, "ciphertext": self.ciphertext}

    @classmethod
    def from_dict(cls, data: dict) -> "EncryptedMessage":
        if data.get("protocol_version") != PROTOCOL_VERSION:
            raise ValueError("unsupported E2E protocol version")
        session_id = data.get("session_id")
        direction = data.get("direction")
        sequence = data.get("sequence_number")
        nonce = data.get("nonce")
        ciphertext = data.get("ciphertext")
        if not isinstance(session_id, str) or not session_id or len(session_id) > _MAX_SESSION_ID:
            raise ValueError("invalid session ID")
        if direction not in {"consumer_to_provider", "provider_to_consumer"}:
            raise ValueError("invalid message direction")
        if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
            raise ValueError("invalid sequence number")
        if not isinstance(nonce, str) or not isinstance(ciphertext, str):
            raise ValueError("invalid encrypted message")
        return cls(session_id, direction, sequence, nonce, ciphertext)


class E2ESession:
    def __init__(self, session_id: str, keys: SessionKeys, *, is_consumer: bool):
        if not session_id:
            raise ValueError("session_id is required")
        self.session_id = session_id
        self._keys = keys
        self._send_direction = "consumer_to_provider" if is_consumer else "provider_to_consumer"
        self._receive_direction = "provider_to_consumer" if is_consumer else "consumer_to_provider"
        self._send_sequence = 0
        self._last_received_sequence = -1

    @classmethod
    def derive(cls, *, session_id: str, shared_secret: bytes, transcript: bytes,
               is_consumer: bool) -> "E2ESession":
        if len(shared_secret) != 32:
            raise ValueError("X25519 shared secret must be 32 bytes")
        transcript_hash = hashlib.sha256(transcript).digest()
        material = HKDF(algorithm=hashes.SHA256(), length=64, salt=transcript_hash,
                        info=_INFO_PREFIX + b"/" + transcript_hash).derive(shared_secret)
        c2p, p2c = material[:_KEY_SIZE], material[_KEY_SIZE:]
        keys = SessionKeys(c2p, p2c) if is_consumer else SessionKeys(p2c, c2p)
        return cls(session_id, keys, is_consumer=is_consumer)

    def encrypt(self, plaintext: bytes, *, associated_data: bytes = b"") -> EncryptedMessage:
        if len(plaintext) > _MAX_CIPHERTEXT:
            raise ValueError("plaintext too large")
        sequence = self._send_sequence
        self._send_sequence += 1
        nonce = sequence.to_bytes(8, "big") + secrets.token_bytes(4)
        ciphertext = AESGCM(self._keys.send_key).encrypt(
            nonce, plaintext, self._aad(sequence, self._send_direction, associated_data))
        return EncryptedMessage(self.session_id, self._send_direction, sequence, _b64(nonce), _b64(ciphertext))

    def decrypt(self, message: EncryptedMessage, *, associated_data: bytes = b"") -> bytes:
        if message.session_id != self.session_id:
            raise ValueError("session ID mismatch")
        if message.direction != self._receive_direction:
            raise ValueError("message direction mismatch")
        if message.sequence_number <= self._last_received_sequence:
            raise ValueError("replayed or out-of-order message")
        nonce = _unb64(message.nonce)
        ciphertext = _unb64(message.ciphertext)
        if len(nonce) != _NONCE_SIZE:
            raise ValueError("invalid AEAD nonce")
        if len(ciphertext) > _MAX_CIPHERTEXT + 16:
            raise ValueError("ciphertext too large")
        plaintext = AESGCM(self._keys.receive_key).decrypt(
            nonce, ciphertext, self._aad(message.sequence_number, message.direction, associated_data))
        self._last_received_sequence = message.sequence_number
        return plaintext

    def _aad(self, sequence: int, direction: str, associated_data: bytes) -> bytes:
        return (PROTOCOL_VERSION.encode("ascii") + b"|" + self.session_id.encode("utf-8")
                + b"|" + direction.encode("ascii") + b"|" + sequence.to_bytes(8, "big")
                + b"|" + associated_data)


def generate_ephemeral_keypair() -> X25519PrivateKey:
    return X25519PrivateKey.generate()


def ephemeral_public_bytes(private_key: X25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def derive_session(*, private_key: X25519PrivateKey, peer_public_key: bytes, session_id: str,
                   provider_id: str, provider_identity_public_key: bytes,
                   provider_ephemeral_public_key: bytes, consumer_ephemeral_public_key: bytes,
                   admission_id: str, freshness: bytes, is_consumer: bool) -> E2ESession:
    peer = X25519PublicKey.from_public_bytes(peer_public_key)
    shared_secret = private_key.exchange(peer)
    transcript = _transcript(session_id, provider_id, provider_identity_public_key,
                             provider_ephemeral_public_key, consumer_ephemeral_public_key,
                             admission_id, freshness)
    return E2ESession.derive(session_id=session_id, shared_secret=shared_secret,
                             transcript=transcript, is_consumer=is_consumer)


def sign_handshake(identity: ProviderIdentity, *, session_id: str, provider_id: str,
                   provider_ephemeral_public_key: bytes, consumer_ephemeral_public_key: bytes,
                   admission_id: str, freshness: bytes) -> str:
    transcript = _transcript(session_id, provider_id, identity.public_key,
                             provider_ephemeral_public_key, consumer_ephemeral_public_key,
                             admission_id, freshness)
    return _b64(identity.sign(transcript))


def verify_handshake(signature_b64: str, provider_identity_public_key: bytes, *, session_id: str,
                     provider_id: str, provider_ephemeral_public_key: bytes,
                     consumer_ephemeral_public_key: bytes, admission_id: str,
                     freshness: bytes) -> None:
    transcript = _transcript(session_id, provider_id, provider_identity_public_key,
                             provider_ephemeral_public_key, consumer_ephemeral_public_key,
                             admission_id, freshness)
    try:
        Ed25519PublicKey.from_public_bytes(provider_identity_public_key).verify(_unb64(signature_b64), transcript)
    except (InvalidSignature, ValueError) as exc:
        raise ValueError("invalid provider handshake signature") from exc
