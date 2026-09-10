import base64
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from inference_exchange.shared.handshake import ProviderOffer, build_transcript, create_session_hello


def b64_key() -> str:
    return base64.b64encode(b"p" * 32).decode("ascii")


def pub(key: X25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def offer(identity_key: str | None = None, expires_at: int | None = None) -> ProviderOffer:
    return ProviderOffer(
        provider_id="provider-1",
        provider_identity_public_key=identity_key or b64_key(),
        app_attest_key_id="key-1",
        security_profile="L2",
        protocol_version="0.1.0",
        models=("default",),
        expires_at=expires_at or int(time.time()) + 300,
        admission_id="admission-1",
        artifact_or_build_hash="sha256:abc",
    )


def test_expired_offer_rejected():
    with pytest.raises(ValueError, match="expired"):
        offer(expires_at=int(time.time()) - 1).validate()


def test_non_l2_offer_rejected():
    p = offer()
    bad = ProviderOffer(**{**p.to_dict(), "security_profile": "hardened"})
    with pytest.raises(ValueError, match="L2"):
        bad.validate()


def test_session_hello_contains_no_plaintext_inference():
    p = offer()
    hello = create_session_hello(p, pub(X25519PrivateKey.generate()))
    assert "messages" not in hello
    assert hello["provider_id"] == p.provider_id
    assert hello["admission_id"] == p.admission_id


def test_transcript_binds_freshness_and_identity():
    p = offer()
    provider_key = pub(X25519PrivateKey.generate())
    consumer_key = pub(X25519PrivateKey.generate())
    base = dict(session_id="s1", provider=p, provider_ephemeral_public_key=provider_key,
                consumer_ephemeral_public_key=consumer_key)
    a = build_transcript(**base, freshness=b"a" * 32)
    b = build_transcript(**base, freshness=b"b" * 32)
    assert a != b
    other = offer(base64.b64encode(b"q" * 32).decode("ascii"))
    assert build_transcript(**{**base, "provider": other}, freshness=b"a" * 32) != a
