"""OCIP wire protocol messages between coordinator and provider.

All messages are JSON-serialized over WebSocket. Each message has a "type" field
that determines the payload shape.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel


class MessageType(str, Enum):
    REGISTER = "register"
    HEARTBEAT = "heartbeat"
    INFERENCE_RESPONSE = "inference_response"
    INFERENCE_DONE = "inference_done"
    INFERENCE_ERROR = "inference_error"
    ATTESTATION_RESPONSE = "attestation_response"
    REGISTERED = "registered"
    INFERENCE_REQUEST = "inference_request"
    CANCEL_REQUEST = "cancel_request"
    ATTESTATION_CHALLENGE = "attestation_challenge"
    ADMISSION_RESULT = "admission_result"


class TrustLevel(str, Enum):
    OPEN = "open"
    CONTAINED = "contained"
    HARDENED = "hardened"
    CONFIDENTIAL = "confidential"


class ProviderCapabilities(BaseModel):
    models: list[str]
    max_concurrent: int = 2
    trust_level: TrustLevel = TrustLevel.OPEN
    hardware: str = "unknown"
    memory_gb: float = 0
    measured_tps: float = 0
    price_per_mtok_input: float = 0.05
    price_per_mtok_output: float = 0.20


class RegisterMessage(BaseModel):
    type: str = MessageType.REGISTER
    protocol_version: str = "0.1.0"
    provider_name: str
    capabilities: ProviderCapabilities
    encryption_public_key: str = ""
    model_identity: dict[str, Any] | None = None
    # App Attest is an admission credential, not an L2 claim. Providers that
    # cannot support the current platform profile leave these fields empty.
    app_attest_key_id: str = ""
    app_attest_app_id: str = ""
    app_attest_environment: str = "production"
    provider_artifact_hash: str = ""


class RegisteredMessage(BaseModel):
    type: str = MessageType.REGISTERED
    provider_id: str
    confidence_level: str = "open"
    protocol_version: str = "0.1.0"


class AdmissionResult(BaseModel):
    """Coordinator → Provider: result of provider admission."""

    type: str = MessageType.ADMISSION_RESULT
    admitted: bool
    reason: str = ""
    admission_id: str = ""
    expires_at: float = 0.0


class HeartbeatMessage(BaseModel):
    type: str = MessageType.HEARTBEAT
    active_requests: int = 0
    loaded_models: list[str] = []
    memory_used_gb: float = 0
    cpu_percent: float = 0


class InferenceResponseChunk(BaseModel):
    type: str = MessageType.INFERENCE_RESPONSE
    request_id: str
    token: str = ""
    encrypted_token: dict | None = None
    finish_reason: str | None = None


class InferenceDone(BaseModel):
    type: str = MessageType.INFERENCE_DONE
    request_id: str
    tokens_generated: int = 0
    time_seconds: float = 0


class InferenceError(BaseModel):
    type: str = MessageType.INFERENCE_ERROR
    request_id: str
    error: str


class InferenceRequest(BaseModel):
    type: str = MessageType.INFERENCE_REQUEST
    request_id: str
    model: str
    messages: list[dict[str, Any]] | None = None
    encrypted_body: dict | None = None
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = True


class CancelRequest(BaseModel):
    type: str = MessageType.CANCEL_REQUEST
    request_id: str


class AttestationChallenge(BaseModel):
    """Coordinator → provider: fresh admission challenge."""

    type: str = MessageType.ATTESTATION_CHALLENGE
    nonce: str
    timestamp: float = 0.0
    purpose: str = "provider-admission"
    required_profile: str = "hardened"


class AttestationResponse(BaseModel):
    """Provider → coordinator: App Attest + runtime evidence.

    App Attest evidence is represented separately from local L2 evidence. The
    coordinator must not interpret local booleans as a substitute for Apple's
    cryptographic App Attest verification.
    """

    type: str = MessageType.ATTESTATION_RESPONSE
    nonce: str
    app_attest_key_id: str = ""
    app_attest_app_id: str = ""
    app_attest_environment: str = "production"
    app_attest_attestation_object: str = ""
    app_attest_assertion: str = ""
    app_attest_client_data: str = ""
    sip_enabled: bool = False
    secure_boot: bool = False
    hardware_attestation: bool = False
    os_version: str = ""
    agent_binary_hash: str = ""
    server_binary_hash: str = ""
    hardened_runtime: bool = False
    pt_deny_attach: bool = False
    platform: str = ""
    provider_encryption_public_key: str = ""
    provider_artifact_hash: str = ""
    protocol_version: str = "0.1.0"
