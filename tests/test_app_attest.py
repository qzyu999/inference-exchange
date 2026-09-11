import base64

import pytest

from inference_exchange.coordinator.app_attest import (
    AppAttestVerificationError,
    verify_admission_binding,
)


def test_admission_requires_strong_challenge():
    with pytest.raises(AppAttestVerificationError, match="128 bits"):
        verify_admission_binding(
            verified=type(
                "Verified",
                (),
                {
                    "key_id": "key",
                    "app_id": "TEAM.bundle",
                    "environment": "production",
                    "public_key_sha256": "hash",
                    "attestation_sha256": "att",
                },
            )(),
            challenge=b"short",
            provider_encryption_key="provider-key",
            artifact_hash="artifact",
            expected_app_id="TEAM.bundle",
            expected_environment="production",
            expected_protocol_version="0.1.0",
            protocol_version="0.1.0",
        )


def test_admission_rejects_identity_mismatch():
    verified = type(
        "Verified",
        (),
        {
            "key_id": base64.b64encode(b"key").decode(),
            "app_id": "TEAM.other",
            "environment": "production",
            "public_key_sha256": "hash",
            "attestation_sha256": "att",
        },
    )()
    with pytest.raises(AppAttestVerificationError, match="identity mismatch"):
        verify_admission_binding(
            verified=verified,
            challenge=b"0123456789abcdef",
            provider_encryption_key="provider-key",
            artifact_hash="artifact",
            expected_app_id="TEAM.bundle",
            expected_environment="production",
            expected_protocol_version="0.1.0",
            protocol_version="0.1.0",
        )


def test_admission_rejects_empty_binding_values():
    verified = type(
        "Verified",
        (),
        {
            "key_id": "key",
            "app_id": "TEAM.bundle",
            "environment": "production",
            "public_key_sha256": "hash",
            "attestation_sha256": "att",
        },
    )()
    with pytest.raises(AppAttestVerificationError, match="missing provider encryption key"):
        verify_admission_binding(
            verified=verified,
            challenge=b"0123456789abcdef",
            provider_encryption_key="",
            artifact_hash="artifact",
            expected_app_id="TEAM.bundle",
            expected_environment="production",
            expected_protocol_version="0.1.0",
            protocol_version="0.1.0",
        )
