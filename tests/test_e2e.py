import pytest

from inference_exchange.shared.e2e import (
    ProviderIdentity,
    derive_session,
    ephemeral_public_bytes,
    generate_ephemeral_keypair,
    sign_handshake,
    verify_handshake,
)


def make_pair():
    session_id = "session-123"
    provider_id = "provider-1"
    admission_id = "admission-abc"
    provider_identity = ProviderIdentity.generate()
    consumer_ephemeral = generate_ephemeral_keypair()
    provider_ephemeral = generate_ephemeral_keypair()
    consumer_pub = ephemeral_public_bytes(consumer_ephemeral)
    provider_pub = ephemeral_public_bytes(provider_ephemeral)
    signature = sign_handshake(
        provider_identity,
        session_id=session_id,
        provider_id=provider_id,
        provider_ephemeral_public_key=provider_pub,
        consumer_ephemeral_public_key=consumer_pub,
        admission_id=admission_id,
    )
    verify_handshake(
        signature,
        provider_identity.public_key,
        session_id=session_id,
        provider_id=provider_id,
        provider_ephemeral_public_key=provider_pub,
        consumer_ephemeral_public_key=consumer_pub,
        admission_id=admission_id,
    )
    consumer = derive_session(
        private_key=consumer_ephemeral,
        peer_public_key=provider_pub,
        session_id=session_id,
        provider_id=provider_id,
        provider_identity_public_key=provider_identity.public_key,
        provider_ephemeral_public_key=provider_pub,
        consumer_ephemeral_public_key=consumer_pub,
        admission_id=admission_id,
        is_consumer=True,
    )
    provider = derive_session(
        private_key=provider_ephemeral,
        peer_public_key=consumer_pub,
        session_id=session_id,
        provider_id=provider_id,
        provider_identity_public_key=provider_identity.public_key,
        provider_ephemeral_public_key=provider_pub,
        consumer_ephemeral_public_key=consumer_pub,
        admission_id=admission_id,
        is_consumer=False,
    )
    return consumer, provider, signature, provider_identity, session_id, provider_id, admission_id, provider_pub, consumer_pub


def test_authenticated_ephemeral_session_round_trip():
    consumer, provider, *_ = make_pair()
    message = consumer.encrypt(b"secret prompt", associated_data=b"request")
    assert provider.decrypt(message, associated_data=b"request") == b"secret prompt"

    response = provider.encrypt(b"secret response", associated_data=b"response")
    assert consumer.decrypt(response, associated_data=b"response") == b"secret response"


def test_tampered_ciphertext_is_rejected():
    consumer, provider, *_ = make_pair()
    message = consumer.encrypt(b"secret prompt")
    tampered = message.to_dict()
    raw = bytearray(__import__("base64").b64decode(tampered["ciphertext"]))
    raw[-1] ^= 1
    tampered["ciphertext"] = __import__("base64").b64encode(raw).decode()

    from inference_exchange.shared.e2e import EncryptedMessage
    with pytest.raises(Exception):
        provider.decrypt(EncryptedMessage.from_dict(tampered))


def test_replay_is_rejected():
    consumer, provider, *_ = make_pair()
    message = consumer.encrypt(b"secret prompt")
    provider.decrypt(message)
    with pytest.raises(ValueError, match="replayed"):
        provider.decrypt(message)


def test_handshake_signature_binds_transcript():
    _, _, signature, identity, session_id, provider_id, admission_id, provider_pub, consumer_pub = make_pair()
    with pytest.raises(ValueError, match="invalid provider handshake signature"):
        verify_handshake(
            signature,
            identity.public_key,
            session_id=session_id,
            provider_id=provider_id,
            provider_ephemeral_public_key=provider_pub,
            consumer_ephemeral_public_key=consumer_pub,
            admission_id="wrong-admission",
        )
