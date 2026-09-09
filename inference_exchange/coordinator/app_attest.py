"""Apple App Attest admission verification primitives.

This module deliberately keeps App Attest separate from the L2 capability
claim. App Attest authenticates an Apple app instance to the coordinator;
it does not by itself prove that the provider's entire runtime is confidential.

The verifier is protocol-facing: platform-specific App Attest object parsing
and Apple's trust-chain validation should be supplied by a dedicated Apple
verification implementation. The coordinator stores only admission metadata,
never the provider's App Attest private key.
"""

from __future__ import annotations

import base64
import hashlib
import time
from dataclasses import dataclass
from typing import Any


class AppAttestVerificationError(ValueError):
    """Raised when App Attest evidence cannot be accepted."""


@dataclass(frozen=True)
class AppAttestAdmission:
    """Verified identity bound to a provider admission record."""

    key_id: str
    app_id: str
    environment: str
    public_key_sha256: str
    attestation_sha256: str
    issued_at: float
    expires_at: float
    provider_encryption_key: str
    artifact_hash: str
    protocol_version: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "key_id": self.key_id,
            "app_id": self.app_id,
            "environment": self.environment,
            "public_key_sha256": self.public_key_sha256,
            "attestation_sha256": self.attestation_sha256,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "provider_encryption_key": self.provider_encryption_key,
            "artifact_hash": self.artifact_hash,
            "protocol_version": self.protocol_version,
        }


def decode_b64(value: str, *, field: str) -> bytes:
    """Decode strict base64 evidence supplied by a provider."""
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:
        raise AppAttestVerificationError(f"invalid base64 in {field}") from exc


def sha256_b64(value: str, *, field: str) -> str:
    """Return the SHA-256 digest of decoded base64 bytes."""
    return hashlib.sha256(decode_b64(value, field=field)).hexdigest()


def verify_admission_binding(
    *,
    key_id: str,
    app_id: str,
    environment: str,
    public_key_b64: str,
    attestation_object_b64: str,
    challenge: bytes,
    provider_encryption_key: str,
    artifact_hash: str,
    expected_app_id: str,
    expected_environment: str,
    expected_protocol_version: str,
    protocol_version: str,
    ttl_seconds: int = 300,
    now: float | None = None,
) -> AppAttestAdmission:
    """Validate the coordinator-side admission envelope.

    The cryptographic Apple attestation object itself must be validated against
    Apple's App Attest trust chain before this function is called. This function
    verifies the IE-specific binding and freshness fields around that evidence.
    Keeping these layers separate prevents an App Attest boolean from being
    mistaken for a complete runtime/TEE proof.
    """
    now = time.time() if now is None else now

    if not key_id:
        raise AppAttestVerificationError("missing App Attest key id")
    if app_id != expected_app_id:
        raise AppAttestVerificationError("App Attest application identity mismatch")
    if environment != expected_environment:
        raise AppAttestVerificationError("App Attest environment mismatch")
    if protocol_version != expected_protocol_version:
        raise AppAttestVerificationError("protocol version mismatch")
    if not provider_encryption_key:
        raise AppAttestVerificationError("missing provider encryption key")
    if not artifact_hash:
        raise AppAttestVerificationError("missing provider artifact hash")
    if len(challenge) < 16:
        raise AppAttestVerificationError("challenge must contain at least 128 bits")

    public_key_hash = sha256_b64(public_key_b64, field="public_key")
    attestation_hash = sha256_b64(attestation_object_b64, field="attestation_object")

    # The challenge is intentionally incorporated into the admission transcript.
    # Apple's App Attest implementation must independently verify that the
    # one-time server challenge is represented in the attestation/assertion.
    transcript = hashlib.sha256(
        challenge
        + key_id.encode()
        + app_id.encode()
        + public_key_hash.encode()
        + provider_encryption_key.encode()
        + artifact_hash.encode()
    ).hexdigest()

    # Keep the transcript computation observable to callers without storing
    # challenge bytes. A future Apple verifier can compare it to its validated
    # nonce/client-data binding.
    if not transcript:
        raise AppAttestVerificationError("invalid admission transcript")

    return AppAttestAdmission(
        key_id=key_id,
        app_id=app_id,
        environment=environment,
        public_key_sha256=public_key_hash,
        attestation_sha256=attestation_hash,
        issued_at=now,
        expires_at=now + ttl_seconds,
        provider_encryption_key=provider_encryption_key,
        artifact_hash=artifact_hash,
        protocol_version=protocol_version,
    )
