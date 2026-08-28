"""OCIP Confidential Transport — X25519 + XSalsa20-Poly1305 (NaCl Box).

Implements per-request ephemeral key exchange with forward secrecy.
The coordinator encrypts to the provider's public key using a fresh
ephemeral keypair per request. The provider decrypts with its private key.
"""

import base64
import json
import logging
from dataclasses import dataclass

from nacl.public import Box, PrivateKey, PublicKey
from nacl.utils import random as nacl_random

logger = logging.getLogger(__name__)


@dataclass
class EncryptedPayload:
    """An OCIP-encrypted message."""

    ephemeral_public_key: str  # base64
    nonce: str  # base64
    ciphertext: str  # base64

    def to_dict(self) -> dict:
        return {
            "ocip_encrypted": True,
            "algorithm": "x25519-xsalsa20-poly1305",
            "ephemeral_public_key": self.ephemeral_public_key,
            "nonce": self.nonce,
            "ciphertext": self.ciphertext,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EncryptedPayload":
        return cls(
            ephemeral_public_key=data["ephemeral_public_key"],
            nonce=data["nonce"],
            ciphertext=data["ciphertext"],
        )


class KeyPair:
    """An X25519 keypair for OCIP confidential transport."""

    def __init__(self, private_key: PrivateKey | None = None):
        self._private_key = private_key or PrivateKey.generate()

    @property
    def private_key(self) -> PrivateKey:
        return self._private_key

    @property
    def public_key(self) -> PublicKey:
        return self._private_key.public_key

    @property
    def public_key_b64(self) -> str:
        """Base64-encoded public key for wire transmission."""
        return base64.b64encode(bytes(self.public_key)).decode()

    @classmethod
    def from_b64(cls, private_key_b64: str) -> "KeyPair":
        """Load from base64-encoded private key."""
        raw = base64.b64decode(private_key_b64)
        return cls(PrivateKey(raw))


def encrypt_to_recipient(plaintext: str, recipient_public_key_b64: str) -> EncryptedPayload:
    """Encrypt a message to a recipient using a fresh ephemeral key (forward secrecy).

    Args:
        plaintext: The JSON string to encrypt
        recipient_public_key_b64: Base64 encoding of recipient's X25519 public key

    Returns:
        EncryptedPayload with ephemeral public key, nonce, and ciphertext
    """
    # Generate fresh ephemeral keypair (discarded after this function)
    ephemeral = PrivateKey.generate()

    # Decode recipient's public key
    recipient_pk = PublicKey(base64.b64decode(recipient_public_key_b64))

    # Create NaCl Box (X25519 ECDH + XSalsa20-Poly1305)
    box = Box(ephemeral, recipient_pk)

    # Encrypt (Box generates a random nonce internally)
    plaintext_bytes = plaintext.encode("utf-8")
    encrypted = box.encrypt(plaintext_bytes)

    # encrypted = nonce (24 bytes) + ciphertext
    nonce = encrypted.nonce
    ciphertext = encrypted.ciphertext

    return EncryptedPayload(
        ephemeral_public_key=base64.b64encode(bytes(ephemeral.public_key)).decode(),
        nonce=base64.b64encode(nonce).decode(),
        ciphertext=base64.b64encode(ciphertext).decode(),
    )


def decrypt_from_sender(payload: EncryptedPayload, recipient_private_key: PrivateKey) -> str:
    """Decrypt a message using the recipient's private key.

    Args:
        payload: The encrypted payload (ephemeral key + nonce + ciphertext)
        recipient_private_key: The recipient's X25519 private key

    Returns:
        Decrypted plaintext string
    """
    # Decode sender's ephemeral public key
    sender_pk = PublicKey(base64.b64decode(payload.ephemeral_public_key))

    # Decode nonce and ciphertext
    nonce = base64.b64decode(payload.nonce)
    ciphertext = base64.b64decode(payload.ciphertext)

    # Create NaCl Box and decrypt
    box = Box(recipient_private_key, sender_pk)
    plaintext_bytes = box.decrypt(ciphertext, nonce)

    return plaintext_bytes.decode("utf-8")


def encrypt_json(data: dict, recipient_public_key_b64: str) -> EncryptedPayload:
    """Convenience: encrypt a dict as JSON."""
    plaintext = json.dumps(data, separators=(",", ":"), sort_keys=True)
    return encrypt_to_recipient(plaintext, recipient_public_key_b64)


def decrypt_json(payload: EncryptedPayload, recipient_private_key: PrivateKey) -> dict:
    """Convenience: decrypt to a dict."""
    plaintext = decrypt_from_sender(payload, recipient_private_key)
    return json.loads(plaintext)
