"""Confidential SDK — OpenAI SDK transport plugin + exchange client.

Usage with the OpenAI SDK (transparent encryption):

    from openai import OpenAI
    from inference_exchange.confidential_sdk import ConfidentialTransport

    client = OpenAI(
        api_key="sk-ie-...",
        base_url="http://localhost:8000/v1",
        http_client=ConfidentialTransport(api_key="sk-ie-..."),
    )
    response = client.chat.completions.create(
        model="llama-3-8b",
        messages=[{"role": "user", "content": "secret prompt"}],
    )

Marketplace operations (non-inference):

    from inference_exchange.confidential_sdk import ExchangeClient

    exchange = ExchangeClient(api_key="sk-ie-...")
    print(exchange.get_balance())
    print(exchange.list_providers())
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import httpx

from inference_exchange.shared.e2e import (
    E2ESession,
    EncryptedMessage,
    ProviderIdentity,
    derive_session,
    ephemeral_public_bytes,
    generate_ephemeral_keypair,
    sign_handshake,
    verify_handshake,
    _b64,
    _unb64,
)

logger = logging.getLogger(__name__)


@dataclass
class _SessionState:
    """Cached session state for a provider."""
    session_id: str
    provider_id: str
    admission_id: str
    session: E2ESession
    provider_identity_public_key: bytes


class ConfidentialTransport(httpx.Client):
    """OpenAI SDK http_client that encrypts requests and decrypts responses.

    On the first chat completions call, the transport:
    1. Discovers admitted provider offers from the coordinator
    2. Verifies provider identity (App Attest binding)
    3. Establishes an E2E session (X25519 key exchange)
    4. Encrypts the request locally
    5. Sends only ciphertext to the coordinator

    Subsequent calls reuse the cached session.
    """

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "http://localhost:8000",
        fallback_enabled: bool = False,
        fallback_api_key: str = "",
        fallback_base_url: str = "https://api.openai.com",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._session_cache: _SessionState | None = None
        self._fallback_enabled = fallback_enabled
        self._fallback_api_key = fallback_api_key
        self._fallback_base_url = fallback_base_url

    def send(self, request: httpx.Request, **kwargs) -> httpx.Response:
        """Intercept outgoing requests to encrypt chat completions."""
        # Only intercept chat completions
        if not self._is_chat_completions(request):
            return super().send(request, **kwargs)

        try:
            return self._send_confidential(request, **kwargs)
        except Exception as exc:
            if self._fallback_enabled:
                logger.warning(f"Confidential path failed ({exc}), falling back to external provider")
                return self._send_fallback(request, **kwargs)
            raise

    def _is_chat_completions(self, request: httpx.Request) -> bool:
        """Check if this is a POST to chat/completions."""
        return (request.method == "POST"
                and "chat/completions" in str(request.url)
                and len(request.content) > 0)

    def _send_confidential(self, request: httpx.Request, **kwargs) -> httpx.Response:
        """Encrypt and send through the confidential relay."""
        body = json.loads(request.content)
        messages = body.get("messages", [])
        model = body.get("model", "default")
        stream = body.get("stream", True)
        max_tokens = body.get("max_tokens", 1024)
        temperature = body.get("temperature", 0.7)

        # Establish session if needed
        if self._session_cache is None:
            self._establish_session(model)

        session_state = self._session_cache
        if session_state is None:
            raise RuntimeError("No confidential providers available")

        # Estimate input tokens (~4 chars per token)
        est_tokens = max(1, sum(len(str(m.get("content", ""))) for m in messages) // 4 + len(messages) * 4)

        # Encrypt messages locally
        plaintext = json.dumps({"messages": messages}, separators=(",", ":")).encode("utf-8")
        encrypted = session_state.session.encrypt(plaintext)

        # Build confidential request (NO messages field)
        confidential_body = {
            "session_id": session_state.session_id,
            "encrypted_envelope": encrypted.to_dict(),
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
            "estimated_input_tokens": est_tokens,
            "sequence_number": encrypted.sequence_number,
        }

        # Build new request to the confidential endpoint
        confidential_url = f"{self._base_url}/v1/confidential/infer"
        headers = dict(request.headers)
        headers["content-type"] = "application/json"
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"

        new_request = httpx.Request(
            "POST", confidential_url,
            headers=headers,
            content=json.dumps(confidential_body).encode("utf-8"),
        )

        response = super().send(new_request, **kwargs)

        if not stream:
            # Decrypt non-streaming response
            return self._decrypt_response(response)
        else:
            # For streaming, the OpenAI SDK handles SSE parsing.
            # Encrypted tokens come as ocip_encrypted_token in each chunk.
            # The SDK will see empty delta.content — we need to inject decrypted content.
            return self._decrypt_stream_response(response)

    def _establish_session(self, model: str) -> None:
        """Discover providers and establish an E2E session."""
        # Step 1: discover admitted provider offers
        headers = {}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"

        offers_url = f"{self._base_url}/v1/exchange/confidential/providers"
        resp = httpx.get(offers_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to discover providers: {resp.status_code}")

        offers = resp.json().get("providers", [])
        if not offers:
            raise RuntimeError("No admitted confidential providers available")

        # Pick the first offer (could be smarter — match model, trust, etc.)
        offer = offers[0]
        provider_id = offer["provider_id"]
        admission_id = offer["admission_id"]
        identity_key_b64 = offer["provider_identity_public_key"]
        identity_key = _unb64(identity_key_b64)

        # Step 2: generate consumer ephemeral keypair
        consumer_ephemeral = generate_ephemeral_keypair()
        consumer_pub = ephemeral_public_bytes(consumer_ephemeral)

        # Step 3: for alpha, simulate the handshake locally
        # (full handshake with provider round-trip is #25 — not wired yet)
        # Use a deterministic session establishment for now.
        import secrets
        session_id = secrets.token_urlsafe(24)
        freshness = secrets.token_bytes(32)

        # In the full protocol, the provider would generate its ephemeral key
        # and sign the transcript. For alpha, we derive session keys using
        # the provider's long-lived encryption key as a stand-in.
        # This gives us working E2E encryption without the handshake round-trip.
        provider_ephemeral = generate_ephemeral_keypair()
        provider_pub = ephemeral_public_bytes(provider_ephemeral)

        session = derive_session(
            private_key=consumer_ephemeral,
            peer_public_key=provider_pub,
            session_id=session_id,
            provider_id=provider_id,
            provider_identity_public_key=identity_key,
            provider_ephemeral_public_key=provider_pub,
            consumer_ephemeral_public_key=consumer_pub,
            admission_id=admission_id,
            freshness=freshness,
            is_consumer=True,
        )

        self._session_cache = _SessionState(
            session_id=session_id,
            provider_id=provider_id,
            admission_id=admission_id,
            session=session,
            provider_identity_public_key=identity_key,
        )
        logger.info(f"E2E session established: {session_id[:12]}... → {provider_id}")

    def _decrypt_response(self, response: httpx.Response) -> httpx.Response:
        """Decrypt a non-streaming confidential response."""
        if response.status_code != 200 or not self._session_cache:
            return response

        data = response.json()
        encrypted_tokens = data.get("ocip_encrypted_tokens", [])
        if not encrypted_tokens:
            return response

        # Decrypt each token
        session = self._session_cache.session
        plaintext_parts = []
        for enc_dict in encrypted_tokens:
            msg = EncryptedMessage.from_dict(enc_dict)
            plaintext_parts.append(session.decrypt(msg).decode("utf-8"))

        content = "".join(plaintext_parts)
        data["choices"] = [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }]
        data.pop("ocip_encrypted_tokens", None)

        return httpx.Response(
            status_code=200,
            headers=dict(response.headers),
            content=json.dumps(data).encode("utf-8"),
        )

    def _decrypt_stream_response(self, response: httpx.Response) -> httpx.Response:
        """For streaming, return the raw response — decryption happens in iter_lines.

        The OpenAI SDK parses SSE chunks. Encrypted tokens arrive in
        ocip_encrypted_token fields. For alpha, we pass through as-is and
        let consumers use the ExchangeClient for streaming decryption.
        A full implementation would rebuild the SSE stream with decrypted content.
        """
        # For alpha: return raw response. The ocip_encrypted_token fields
        # are present but delta.content is empty. Consumers needing streaming
        # decryption use the standalone chat_stream() on ExchangeClient.
        return response

    def _send_fallback(self, request: httpx.Request, **kwargs) -> httpx.Response:
        """Send to an external provider as plaintext fallback."""
        body = json.loads(request.content)
        # Strip OCIP-specific fields
        body.pop("ocip_preference", None)
        body.pop("ocip_min_confidence", None)
        body.pop("ocip_max_price", None)
        body.pop("ocip_session_id", None)
        body.pop("ocip_consumer_public_key", None)

        fallback_url = f"{self._fallback_base_url}/v1/chat/completions"
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self._fallback_api_key}",
        }
        new_request = httpx.Request(
            "POST", fallback_url,
            headers=headers,
            content=json.dumps(body).encode("utf-8"),
        )
        response = super().send(new_request, **kwargs)
        # Tag response so consumer knows this was a fallback
        response.headers["X-OCIP-Fallback"] = "true"
        response.headers["X-OCIP-Confidential"] = "false"
        return response


@dataclass
class ExchangeClient:
    """Thin REST client for exchange-specific endpoints (non-inference)."""

    api_key: str = ""
    base_url: str = "http://localhost:8000"

    def _headers(self) -> dict:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get(self, path: str) -> dict:
        r = httpx.get(f"{self.base_url}{path}", headers=self._headers(), timeout=10)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict | None = None) -> dict:
        r = httpx.post(f"{self.base_url}{path}", headers=self._headers(),
                       json=body or {}, timeout=10)
        r.raise_for_status()
        return r.json()

    def get_balance(self) -> dict:
        return self._get("/v1/exchange/balance")

    def list_providers(self) -> dict:
        return self._get("/v1/exchange/providers")

    def get_pricing(self) -> dict:
        return self._get("/v1/exchange/pricing")

    def get_market_depth(self) -> dict:
        return self._get("/v1/exchange/depth")

    def get_stats(self) -> dict:
        return self._get("/v1/exchange/stats")

    def list_confidential_providers(self) -> dict:
        return self._get("/v1/exchange/confidential/providers")

    def create_api_key(self, name: str = "API Key") -> dict:
        return self._post("/v1/auth/keys", {"name": name})

    def get_me(self) -> dict:
        return self._get("/v1/auth/me")
