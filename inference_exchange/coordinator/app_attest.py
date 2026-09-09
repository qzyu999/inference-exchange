"""Server-side Apple App Attest verification and IE admission binding.

App Attest proves that an Apple-attested app instance owns an attested P-256
key. It does not prove the complete L2 runtime boundary, so this module keeps
Apple evidence separate from the project's L2 capability tests.
"""

from __future__ import annotations

import base64
import hashlib
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import cbor2
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.x509 import Certificate

APPLE_NONCE_OID = "1.2.840.113635.100.8.2"
PRODUCTION_AAGUID = b"appattest" + b"\x00" * 7
DEVELOPMENT_AAGUID = b"appattestdevelop"
# SHA-256 fingerprint of Apple's published App Appestation Root CA.
# Keep the root certificate itself in deployment configuration so Apple root
# rotation is an explicit reviewed change.
APPLE_ROOT_SHA256 = "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932"


class AppAttestVerificationError(ValueError):
    """Raised when App Attest evidence cannot be accepted."""


@dataclass(frozen=True)
class VerifiedAppAttest:
    key_id: str
    app_id: str
    environment: str
    public_key_spki_b64: str
    public_key_sha256: str
    attestation_sha256: str


@dataclass(frozen=True)
class AppAttestAdmission:
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
        return self.__dict__.copy()


def decode_b64(value: str, *, field: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:
        raise AppAttestVerificationError(f"invalid base64 in {field}") from exc


def _verify_certificate_signature(cert: Certificate, issuer: Certificate) -> None:
    public_key = issuer.public_key()
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        raise AppAttestVerificationError("App Attest chain contains a non-EC issuer")
    try:
        public_key.verify(
            cert.signature,
            cert.tbs_certificate_bytes,
            ec.ECDSA(cert.signature_hash_algorithm),
        )
    except Exception as exc:
        raise AppAttestVerificationError("invalid App Attest certificate signature") from exc


def _check_certificate_time(cert: Certificate, now: datetime) -> None:
    not_before = getattr(cert, "not_valid_before_utc", cert.not_valid_before.replace(tzinfo=timezone.utc))
    not_after = getattr(cert, "not_valid_after_utc", cert.not_valid_after.replace(tzinfo=timezone.utc))
    if not_before > now or now > not_after:
        raise AppAttestVerificationError("App Attest certificate is outside its validity period")


def _der_read_length(data: bytes, offset: int) -> tuple[int, int]:
    if offset >= len(data):
        raise AppAttestVerificationError("malformed DER")
    first = data[offset]
    offset += 1
    if first < 0x80:
        return first, offset
    count = first & 0x7F
    if count == 0 or count > 4 or offset + count > len(data):
        raise AppAttestVerificationError("malformed DER length")
    length = int.from_bytes(data[offset:offset + count], "big")
    return length, offset + count


def _der_value(data: bytes, offset: int = 0) -> tuple[int, bytes, int]:
    if offset >= len(data):
        raise AppAttestVerificationError("malformed DER")
    tag = data[offset]
    length, value_offset = _der_read_length(data, offset + 1)
    end = value_offset + length
    if end > len(data):
        raise AppAttestVerificationError("malformed DER value")
    return tag, data[value_offset:end], end


def _extract_nonce_from_extension(value: bytes) -> bytes:
    """Extract Apple's nonce OCTET STRING from the extension DER value."""
    tag, sequence, _ = _der_value(value)
    if tag != 0x30:
        # Some libraries expose the inner octet directly.
        if tag == 0x04:
            return sequence
        raise AppAttestVerificationError("malformed App Attest nonce extension")
    tag, nonce, _ = _der_value(sequence)
    if tag != 0x04:
        raise AppAttestVerificationError("malformed App Attest nonce extension")
    return nonce


def _extract_extension_nonce(cert: Certificate) -> bytes:
    oid = x509.ObjectIdentifier(APPLE_NONCE_OID)
    try:
        extension = cert.extensions.get_extension_for_oid(oid)
    except x509.ExtensionNotFound as exc:
        raise AppAttestVerificationError("App Attest nonce extension missing") from exc
    if not isinstance(extension.value, x509.UnrecognizedExtension):
        raise AppAttestVerificationError("unexpected App Attest nonce extension type")
    return _extract_nonce_from_extension(extension.value.value)


def _parse_auth_data(auth_data: bytes) -> tuple[bytes, int, bytes, bytes, bytes]:
    # rpIdHash (32) | flags (1) | counter (4) | aaguid (16) |
    # credentialIdLength (2) | credentialId | credentialPublicKey (CBOR)
    if len(auth_data) < 55:
        raise AppAttestVerificationError("malformed App Attest authenticator data")
    rp_id_hash = auth_data[:32]
    counter = int.from_bytes(auth_data[33:37], "big")
    aaguid = auth_data[37:53]
    credential_len = int.from_bytes(auth_data[53:55], "big")
    end = 55 + credential_len
    if end > len(auth_data):
        raise AppAttestVerificationError("malformed App Attest credential identifier")
    credential_id = auth_data[55:end]
    cose_key = auth_data[end:]
    if not cose_key:
        raise AppAttestVerificationError("missing App Attest credential public key")
    return rp_id_hash, counter, aaguid, credential_id, cose_key


def _leaf_public_point(cert: Certificate) -> bytes:
    key = cert.public_key()
    if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
        raise AppAttestVerificationError("App Attest credential key is not P-256")
    return key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)


def verify_attestation(
    *,
    attestation_object_b64: str,
    key_id_b64: str,
    challenge: bytes,
    app_id: str,
    environment: str,
    root_pem: bytes,
    expected_root_sha256: str = APPLE_ROOT_SHA256,
) -> VerifiedAppAttest:
    """Verify an Apple App Attest attestation object.

    `challenge` is the exact server challenge that the provider hashed before
    passing it to `DCAppAttestService.attestKey`. The function fails closed on
    every validation failure.
    """
    if len(challenge) < 16:
        raise AppAttestVerificationError("challenge must contain at least 128 bits")
    if environment not in {"production", "development"}:
        raise AppAttestVerificationError("unsupported App Attest environment")

    raw = decode_b64(attestation_object_b64, field="attestation_object")
    key_id = decode_b64(key_id_b64, field="key_id")
    try:
        obj = cbor2.loads(raw)
    except Exception as exc:
        raise AppAttestVerificationError("invalid App Attest CBOR") from exc

    if obj.get("fmt") != "apple-appattest":
        raise AppAttestVerificationError("unexpected App Attest format")
    stmt = obj.get("attStmt") or {}
    auth_data = obj.get("authData")
    x5c = stmt.get("x5c") or []
    if not isinstance(auth_data, bytes) or len(x5c) < 2:
        raise AppAttestVerificationError("incomplete App Attest attestation object")

    try:
        leaf = x509.load_der_x509_certificate(x5c[0])
        intermediate = x509.load_der_x509_certificate(x5c[1])
        root = x509.load_pem_x509_certificate(root_pem)
    except Exception as exc:
        raise AppAttestVerificationError("invalid App Attest certificate") from exc

    root_hash = root.fingerprint(hashlib.sha256()).hex()
    if root_hash != expected_root_sha256.lower():
        raise AppAttestVerificationError("configured App Attest root does not match pinned root")
    now = datetime.now(timezone.utc)
    for cert in (leaf, intermediate, root):
        _check_certificate_time(cert, now)
    if intermediate.issuer != root.subject or leaf.issuer != intermediate.subject:
        raise AppAttestVerificationError("App Attest certificate issuer mismatch")
    _verify_certificate_signature(intermediate, root)
    _verify_certificate_signature(leaf, intermediate)

    rp_id_hash, counter, aaguid, credential_id, _ = _parse_auth_data(auth_data)
    expected_rp_id_hash = hashlib.sha256(app_id.encode()).digest()
    if rp_id_hash != expected_rp_id_hash:
        raise AppAttestVerificationError("App Attest RP ID mismatch")
    expected_aaguid = PRODUCTION_AAGUID if environment == "production" else DEVELOPMENT_AAGUID
    if aaguid != expected_aaguid:
        raise AppAttestVerificationError("App Attest environment/AAGUID mismatch")
    if counter != 0:
        raise AppAttestVerificationError("initial App Attest counter must be zero")
    if credential_id != key_id:
        raise AppAttestVerificationError("App Attest credential ID does not match key id")

    public_point = _leaf_public_point(leaf)
    if hashlib.sha256(public_point).digest() != key_id:
        raise AppAttestVerificationError("App Attest key id does not match credential public key")

    client_data_hash = hashlib.sha256(challenge).digest()
    expected_nonce = hashlib.sha256(auth_data + client_data_hash).digest()
    if _extract_extension_nonce(leaf) != expected_nonce:
        raise AppAttestVerificationError("App Attest challenge nonce mismatch")

    spki = leaf.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    return VerifiedAppAttest(
        key_id=key_id_b64,
        app_id=app_id,
        environment=environment,
        public_key_spki_b64=base64.b64encode(spki).decode(),
        public_key_sha256=hashlib.sha256(public_point).hexdigest(),
        attestation_sha256=hashlib.sha256(raw).hexdigest(),
    )


def verify_admission_binding(
    *,
    verified: VerifiedAppAttest,
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
    now = time.time() if now is None else now
    if verified.app_id != expected_app_id:
        raise AppAttestVerificationError("App Attest application identity mismatch")
    if verified.environment != expected_environment:
        raise AppAttestVerificationError("App Attest environment mismatch")
    if protocol_version != expected_protocol_version:
        raise AppAttestVerificationError("protocol version mismatch")
    if not provider_encryption_key:
        raise AppAttestVerificationError("missing provider encryption key")
    if not artifact_hash:
        raise AppAttestVerificationError("missing provider artifact hash")
    if len(challenge) < 16:
        raise AppAttestVerificationError("challenge must contain at least 128 bits")
    return AppAttestAdmission(
        key_id=verified.key_id,
        app_id=verified.app_id,
        environment=verified.environment,
        public_key_sha256=verified.public_key_sha256,
        attestation_sha256=verified.attestation_sha256,
        issued_at=now,
        expires_at=now + ttl_seconds,
        provider_encryption_key=provider_encryption_key,
        artifact_hash=artifact_hash,
        protocol_version=protocol_version,
    )
