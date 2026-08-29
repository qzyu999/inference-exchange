"""OCIP wire protocol messages between coordinator and provider.

All messages are JSON-serialized over WebSocket. Each message has a "type" field
that determines the payload shape.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel


class MessageType(str, Enum):
    # Provider → Coordinator
    REGISTER = "register"
    HEARTBEAT = "heartbeat"
    INFERENCE_RESPONSE = "inference_response"
    INFERENCE_DONE = "inference_done"
    INFERENCE_ERROR = "inference_error"
    ATTESTATION_RESPONSE = "attestation_response"

    # Coordinator → Provider
    REGISTERED = "registered"  # Coordinator → Provider (confirmation)
    INFERENCE_REQUEST = "inference_request"
    CANCEL_REQUEST = "cancel_request"
    ATTESTATION_CHALLENGE = "attestation_challenge"


class TrustLevel(str, Enum):
    """OCIP confidence levels."""

    OPEN = "open"  # Level 0: no isolation
    CONTAINED = "contained"  # Level 1: container/sandbox
    HARDENED = "hardened"  # Level 2: OS-enforced process protection
    CONFIDENTIAL = "confidential"  # Level 3: hardware memory encryption


# --- Provider → Coordinator ---


class ProviderCapabilities(BaseModel):
    """What this provider can do."""

    models: list[str]  # Model IDs this provider can serve
    max_concurrent: int = 2
    trust_level: TrustLevel = TrustLevel.OPEN
    # Hardware info for scoring
    hardware: str = "unknown"  # e.g. "apple-m4-pro", "amd-ryzen-9-7945"
    memory_gb: float = 0
    measured_tps: float = 0  # Tokens/sec from benchmark
    # Pricing (USD per million tokens)
    price_per_mtok_input: float = 0.05  # $0.05/Mtok input
    price_per_mtok_output: float = 0.20  # $0.20/Mtok output


class RegisterMessage(BaseModel):
    type: str = MessageType.REGISTER
    protocol_version: str = "0.1.0"  # OCIP protocol version
    provider_name: str
    capabilities: ProviderCapabilities
    encryption_public_key: str = ""  # Base64 X25519 public key for E2E encryption
    model_identity: dict[str, Any] | None = None  # Model file hash + metadata from provider


class RegisteredMessage(BaseModel):
    """Coordinator → Provider: confirms registration."""

    type: str = MessageType.REGISTERED
    provider_id: str
    confidence_level: str = "open"
    protocol_version: str = "0.1.0"


class HeartbeatMessage(BaseModel):
    type: str = MessageType.HEARTBEAT
    active_requests: int = 0
    loaded_models: list[str] = []
    memory_used_gb: float = 0
    cpu_percent: float = 0


class InferenceResponseChunk(BaseModel):
    type: str = MessageType.INFERENCE_RESPONSE
    request_id: str
    token: str  # The generated token text
    finish_reason: str | None = None  # "stop", "length", or None if still generating


class InferenceDone(BaseModel):
    type: str = MessageType.INFERENCE_DONE
    request_id: str
    tokens_generated: int = 0
    time_seconds: float = 0


class InferenceError(BaseModel):
    type: str = MessageType.INFERENCE_ERROR
    request_id: str
    error: str


# --- Coordinator → Provider ---


class InferenceRequest(BaseModel):
    type: str = MessageType.INFERENCE_REQUEST
    request_id: str
    model: str
    messages: list[dict[str, Any]] | None = None  # Plaintext (when not encrypted)
    encrypted_body: dict | None = None  # OCIP encrypted payload (when E2E)
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = True


class CancelRequest(BaseModel):
    type: str = MessageType.CANCEL_REQUEST
    request_id: str


class AttestationChallenge(BaseModel):
    """Coordinator → Provider: periodic challenge to verify provider liveness and security state."""
    type: str = MessageType.ATTESTATION_CHALLENGE
    nonce: str  # Random nonce the provider must echo back
    timestamp: float = 0.0  # When the challenge was issued


class AttestationResponse(BaseModel):
    """Provider → Coordinator: response to an attestation challenge."""
    type: str = MessageType.ATTESTATION_RESPONSE
    nonce: str  # Echoed nonce from the challenge
    sip_enabled: bool = False  # System Integrity Protection enabled
    secure_boot: bool = False  # Secure boot enabled
    hardware_attestation: bool = False  # Hardware-level attestation available
    os_version: str = ""  # OS version string
