import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from inference_exchange.shared.e2e import ProviderIdentity
from inference_exchange.shared.handshake import (
    HandshakeParameters,
    ProviderOffer,
    SessionHello,
    build_transcript,
)


def _offer(identity: ProviderIdentity, *, expires_at: int | None = None) -> ProviderOffer:
    return ProviderOffer(
        provider_id="provider-1",
        provider_identity_public_key=identity.public_key_b64,
        app_attest_key_id="app-attest-key-1",
        security_profile="L2",
        protocol_version="0.1.0",
        models=("default",),
        expires_at=expires_at if expires_at is not None else int(time.time()) + 300,
        admission_id="admission-1",
        artifact_or_build_hash="sha256:abc123",
    )


def _pub(key: X25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def test_provider_offer_rejects_expired_admission():
    identity = ProviderIdentity.generate()
    offer = _offer(identity, expires_at=int(time.time()) - 1)
    with pytest.raises(ValueError, match="expired"):
        offer.validate()


def test_provider_offer_rejects_non_l2():
    identity = ProviderIdentity.generate()
    offer = ProviderOffer(
        **{**_offer(identity).to_dict(), "models": ["default"]},
        security_profile="hardened",
    )
    with pytest.raises(ValueError, match="L2"):
        offer.validate()


def test_session_hello_binds_freshness_and_ephemeral_key():
    identity = ProviderIdentity.generate()
    offer = _offer(identity)
    hello, freshness = SessionHello.create(offer)
    consumer_key = X25519PrivateKey.generate()
    hello = SessionHello(
        session_id=hello.session_id,
        provider_id=hello.provider_id,
        admission_id=hello.admission_id,
        consumer_ephemeral_public_key=__import__("base64").urlsafe_b64encode(_pub(consumer_key)).rstrip(b"=").decode(),
        freshness=hello.freshness,
    )
    decoded = SessionHello.from_dict(hello.to_dict())
    assert decoded.session_id == hello.session_id
    assert decoded.freshness
    assert freshness


def test_transcript_changes_when_freshness_changes():
    identity = ProviderIdentity.generate()
    offer = _offer(identity)
    provider_key = X25519PrivateKey.generate()
    consumer_key = X25519PrivateKey.generate()

    first = build_transcript(
        session_id="session-1",
        provider=offer,
        provider_ephemeral_public_key=_pub(provider_key),
        consumer_ephemeral_public_key=_pub(consumer_key),
        freshness=b"a" * 32,
    )
    second = build_transcript(
        session_id="session-1",
        provider=offer,
        provider_ephemeral_public_key=_pub(provider_key),
        consumer_ephemeral_public_key=_pub(consumer_key),
        freshness=b"b" * 32,
    )
    assert first != second


def test_transcript_is_deterministic_and_binds_provider_identity():
    identity = ProviderIdentity.generate()
    offer = _offer(identity)
    provider_key = X25519PrivateKey.generate()
    consumer_key = X25519PrivateKey.generate()
    kwargs = dict(
        session_id="session-1",
        provider=offer,
        provider_ephemeral_public_key=_pub(provider_key),
        consumer_ephemeral_public_key=_pub(consumer_key),
        freshness=b"f" * 32,
    )
    assert build_transcript(**kwargs) == build_transcript(**kwargs)

    other = ProviderIdentity.generate()
    other_offer = _offer(other)
    assert build_transcript(**{**kwargs, "provider": other_offer}) != build_transcript(**kwargs)
