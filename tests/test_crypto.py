"""Tests for E2E encryption — X25519 + XSalsa20-Poly1305 (NaCl Box)."""

import json

import pytest
from nacl.exceptions import CryptoError

from inference_exchange.shared.crypto import (
    EncryptedPayload,
    KeyPair,
    decrypt_from_sender,
    decrypt_json,
    encrypt_json,
    encrypt_to_recipient,
)


# ---------------------------------------------------------------------------
# Encrypt/decrypt roundtrip
# ---------------------------------------------------------------------------

class TestRoundtrip:
    def test_basic_roundtrip(self):
        recipient = KeyPair()
        plaintext = "Hello, OCIP!"
        payload = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        decrypted = decrypt_from_sender(payload, recipient.private_key)
        assert decrypted == plaintext

    def test_empty_string_roundtrip(self):
        recipient = KeyPair()
        payload = encrypt_to_recipient("", recipient.public_key_b64)
        assert decrypt_from_sender(payload, recipient.private_key) == ""

    def test_unicode_roundtrip(self):
        recipient = KeyPair()
        text = "日本語テスト 🔐 émojis ñ"
        payload = encrypt_to_recipient(text, recipient.public_key_b64)
        assert decrypt_from_sender(payload, recipient.private_key) == text

    def test_long_message_roundtrip(self):
        recipient = KeyPair()
        text = "x" * 100_000
        payload = encrypt_to_recipient(text, recipient.public_key_b64)
        assert decrypt_from_sender(payload, recipient.private_key) == text


# ---------------------------------------------------------------------------
# Forward secrecy — different ephemeral keys per request
# ---------------------------------------------------------------------------

class TestForwardSecrecy:
    def test_different_ephemeral_keys(self):
        """Each encryption uses a fresh ephemeral keypair."""
        recipient = KeyPair()
        plaintext = "same message"
        p1 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        p2 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        # Ephemeral public keys should differ
        assert p1.ephemeral_public_key != p2.ephemeral_public_key

    def test_both_decrypt_correctly(self):
        recipient = KeyPair()
        plaintext = "forward secrecy test"
        p1 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        p2 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        assert decrypt_from_sender(p1, recipient.private_key) == plaintext
        assert decrypt_from_sender(p2, recipient.private_key) == plaintext


# ---------------------------------------------------------------------------
# Ciphertext differs for same plaintext (random nonce)
# ---------------------------------------------------------------------------

class TestRandomNonce:
    def test_different_ciphertext_same_plaintext(self):
        """Even with the same plaintext and recipient, ciphertext and nonce differ."""
        recipient = KeyPair()
        plaintext = "deterministic?"
        p1 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        p2 = encrypt_to_recipient(plaintext, recipient.public_key_b64)
        assert p1.ciphertext != p2.ciphertext
        assert p1.nonce != p2.nonce

    def test_payload_structure(self):
        recipient = KeyPair()
        payload = encrypt_to_recipient("test", recipient.public_key_b64)
        d = payload.to_dict()
        assert d["ocip_encrypted"] is True
        assert d["algorithm"] == "x25519-xsalsa20-poly1305"
        assert "ephemeral_public_key" in d
        assert "nonce" in d
        assert "ciphertext" in d


# ---------------------------------------------------------------------------
# Wrong key cannot decrypt
# ---------------------------------------------------------------------------

class TestWrongKey:
    def test_wrong_private_key_fails(self):
        recipient = KeyPair()
        imposter = KeyPair()
        payload = encrypt_to_recipient("secret", recipient.public_key_b64)
        with pytest.raises(CryptoError):
            decrypt_from_sender(payload, imposter.private_key)

    def test_tampered_ciphertext_fails(self):
        recipient = KeyPair()
        payload = encrypt_to_recipient("secret", recipient.public_key_b64)
        # Tamper with ciphertext
        import base64
        raw = bytearray(base64.b64decode(payload.ciphertext))
        raw[0] ^= 0xFF  # Flip first byte
        payload.ciphertext = base64.b64encode(bytes(raw)).decode()
        with pytest.raises(CryptoError):
            decrypt_from_sender(payload, recipient.private_key)


# ---------------------------------------------------------------------------
# JSON encrypt/decrypt roundtrip
# ---------------------------------------------------------------------------

class TestJsonRoundtrip:
    def test_dict_roundtrip(self):
        recipient = KeyPair()
        data = {"model": "llama-3.2", "messages": [{"role": "user", "content": "hi"}]}
        payload = encrypt_json(data, recipient.public_key_b64)
        decrypted = decrypt_json(payload, recipient.private_key)
        assert decrypted == data

    def test_nested_dict_roundtrip(self):
        recipient = KeyPair()
        data = {
            "request_id": "abc123",
            "params": {"temperature": 0.7, "max_tokens": 100},
            "tags": ["test", "crypto"],
        }
        payload = encrypt_json(data, recipient.public_key_b64)
        assert decrypt_json(payload, recipient.private_key) == data

    def test_from_dict_roundtrip(self):
        """EncryptedPayload can be serialized to dict and back."""
        recipient = KeyPair()
        payload = encrypt_to_recipient("payload test", recipient.public_key_b64)
        d = payload.to_dict()
        restored = EncryptedPayload.from_dict(d)
        assert decrypt_from_sender(restored, recipient.private_key) == "payload test"

    def test_keypair_b64_roundtrip(self):
        """KeyPair can be exported and reimported via base64."""
        import base64
        kp = KeyPair()
        b64 = base64.b64encode(bytes(kp.private_key)).decode()
        kp2 = KeyPair.from_b64(b64)
        assert kp2.public_key_b64 == kp.public_key_b64
