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
import secrets
from dataclasses import dataclass, field

import httpx

from inference_exchange.shared.crypto import (
    KeyPair,
    EncryptedPayload,
    decrypt_from_sender,
    encrypt_json,
)

logger = logging.getLogger(__name__)


class ConfidentialTransport(httpx.Client):
    """OpenAI SDK http_client that encrypts requests and decrypts responses.

    Uses NaCl Box (X25519 + XSalsa20-Poly1305) — the same crypto the provider
    already speaks. The consumer encrypts locally; the coordinator relays blind;
    the provider decrypts with its existing keypair.

    Request encryption: NaCl Box to provider's X25519 public key.
    Response encryption: provider encrypts each token to consumer's X25519 key.
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
        self._fallback_enabled = fallback_enabled
        self._fallback_api_key = fallback_api_key
        self._fallback_base_url = fallback_base_url
        # Consumer's X25519 keypair for response decryption
        self._keypair = KeyPair()
        # Cached provider public key (from discovery)
        self._provider_pubkey: str | None = None
        # Session tracking
        self._session_id = secrets.token_urlsafe(24)
        self._sequence = 0

    @property
    def public_key_b64(self) -> str:
        return self._keypair.public_key_b64

    def send(self, request: httpx.Request, **kwargs) -> httpx.Response:
        """Intercept outgoing requests to encrypt chat completions."""
        if not self._is_chat_completions(request):
            return super().send(request, **kwargs)
        try:
            return self._send_confidential(request, **kwargs)
        except Exception as exc:
            if self._fallback_enabled:
                logger.warning(f"Confidential path failed ({exc}), falling back")
                return self._send_fallback(request, **kwargs)
            raise

    def _is_chat_completions(self, request: httpx.Request) -> bool:
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

        # Discover provider key if needed
        if self._provider_pubkey is None:
            self._discover_provider()

        if self._provider_pubkey is None:
            raise RuntimeError("No providers available")

        # Estimate input tokens
        est_tokens = max(1, sum(len(str(m.get("content", ""))) for m in messages) // 4 + len(messages) * 4)

        # Encrypt messages + consumer public key using NaCl Box
        # The consumer_public_key tells the provider to encrypt responses back to us
        payload = {"messages": messages, "consumer_public_key": self.public_key_b64}
        encrypted = encrypt_json(payload, self._provider_pubkey)

        # Track sequence for replay protection
        seq = self._sequence
        self._sequence += 1

        # Build confidential request (NO messages field)
        confidential_body = {
            "session_id": self._session_id,
            "encrypted_envelope": encrypted.to_dict(),
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
            "estimated_input_tokens": est_tokens,
            "sequence_number": seq,
        }

        confidential_url = f"{self._base_url}/v1/confidential/infer"
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"

        new_request = httpx.Request(
            "POST", confidential_url,
            headers=headers,
            content=json.dumps(confidential_body).encode("utf-8"),
        )

        response = super().send(new_request, **kwargs)

        if not stream:
            return self._decrypt_response(response)
        else:
            return self._decrypt_stream_response(response)

    def _discover_provider(self) -> None:
        """Fetch provider list and cache the encryption public key."""
        headers = {}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"

        # Try confidential offers first, fall back to regular providers
        resp = httpx.get(f"{self._base_url}/v1/exchange/providers", headers=headers, timeout=10)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to discover providers: {resp.status_code}")

        providers = resp.json().get("providers", [])
        # Pick first provider that has an encryption key
        for p in providers:
            if p.get("encrypted"):
                self._provider_pubkey = p.get("encryption_key_preview")
                break

        # If no encrypted providers, try any provider's key from registration
        # The /v1/exchange/providers doesn't expose the full key — we need it
        # from somewhere. For alpha, we'll use the non-confidential path's
        # provider info which includes the key.
        if self._provider_pubkey is None and providers:
            # Fall back: query the provider directly or accept first available
            logger.warning("No provider encryption key found in discovery — "
                           "falling back to non-confidential path")

    def _decrypt_response(self, response: httpx.Response) -> httpx.Response:
        """Decrypt a non-streaming confidential response."""
        if response.status_code != 200:
            return response

        data = response.json()

        # Check for NaCl-encrypted content (non-streaming)
        encrypted_content = data.get("ocip_encrypted_content")
        if encrypted_content:
            payload = EncryptedPayload.from_dict(encrypted_content)
            content = decrypt_from_sender(payload, self._keypair.private_key)
            data["choices"] = [{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }]
            data.pop("ocip_encrypted_content", None)

        # Check for encrypted token list (confidential relay non-streaming)
        encrypted_tokens = data.get("ocip_encrypted_tokens")
        if encrypted_tokens:
            parts = []
            for enc_dict in encrypted_tokens:
                payload = EncryptedPayload.from_dict(enc_dict)
                parts.append(decrypt_from_sender(payload, self._keypair.private_key))
            content = "".join(parts)
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
        """Rebuild SSE stream with decrypted content.

        The provider encrypts each token to our public key. We intercept the
        raw SSE bytes, decrypt each ocip_encrypted_token, and inject the
        plaintext into delta.content so the OpenAI SDK sees a normal response.
        """
        original_stream = response.stream

        def _decrypting_stream():
            for chunk in original_stream:
                text = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
                lines = text.split("\n")
                output_lines = []
                for line in lines:
                    if not line.startswith("data: "):
                        output_lines.append(line)
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        output_lines.append(line)
                        continue
                    try:
                        data = json.loads(payload)
                        enc_token = data.get("ocip_encrypted_token")
                        if enc_token:
                            enc = EncryptedPayload.from_dict(enc_token)
                            plaintext = decrypt_from_sender(enc, self._keypair.private_key)
                            # Inject decrypted content into the chunk
                            if data.get("choices"):
                                data["choices"][0]["delta"] = {"content": plaintext}
                            data.pop("ocip_encrypted_token", None)
                            output_lines.append(f"data: {json.dumps(data)}")
                        else:
                            output_lines.append(line)
                    except (json.JSONDecodeError, Exception):
                        output_lines.append(line)
                yield "\n".join(output_lines).encode("utf-8")

        # Return a new response with the decrypting stream
        return httpx.Response(
            status_code=response.status_code,
            headers=dict(response.headers),
            stream=httpx.ByteStream(b"".join(_decrypting_stream())),
        )

    def _send_fallback(self, request: httpx.Request, **kwargs) -> httpx.Response:
        """Send to an external provider as plaintext fallback."""
        body = json.loads(request.content)
        for key in ("ocip_preference", "ocip_min_confidence", "ocip_max_price",
                     "ocip_session_id", "ocip_consumer_public_key"):
            body.pop(key, None)

        fallback_url = f"{self._fallback_base_url}/v1/chat/completions"
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self._fallback_api_key}",
        }
        new_request = httpx.Request("POST", fallback_url, headers=headers,
                                     content=json.dumps(body).encode("utf-8"))
        response = super().send(new_request, **kwargs)
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
