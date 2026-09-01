"""Inference Exchange SDK -- OpenAI-compatible client with E2E response encryption.

Usage:
    from inference_exchange.ie_sdk import InferenceExchange

    client = InferenceExchange(api_key="sk-ie-...", base_url="http://localhost:8000/v1")
    response = client.chat(messages=[{"role": "user", "content": "Hello"}])
    print(response["choices"][0]["message"]["content"])

    # Streaming
    for chunk in client.chat_stream(messages=[{"role": "user", "content": "Hello"}]):
        print(chunk, end="", flush=True)

When E2E is enabled (default), prompts AND responses are encrypted end-to-end.
The coordinator and provider operator cannot read either.
"""

import json
import logging
from dataclasses import dataclass, field

import httpx

from inference_exchange.shared.crypto import (
    KeyPair,
    EncryptedPayload,
    decrypt_from_sender,
)

logger = logging.getLogger(__name__)


@dataclass
class InferenceExchange:
    """E2E encrypted inference client. Same API shape as OpenAI SDK."""

    api_key: str = ""
    base_url: str = "http://localhost:8000/v1"
    e2e: bool = True  # Enable response encryption (requires IE provider support)
    _keypair: KeyPair = field(default_factory=KeyPair, repr=False)

    @property
    def public_key_b64(self) -> str:
        return self._keypair.public_key_b64

    def chat(
        self,
        messages: list[dict],
        model: str = "default",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        preference: str = "balanced",
        **kwargs,
    ) -> dict:
        """Non-streaming chat completion. Returns full response dict."""
        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            "ocip_preference": preference,
            **kwargs,
        }
        if self.e2e:
            body["ocip_consumer_public_key"] = self.public_key_b64

        with httpx.Client() as client:
            r = client.post(
                f"{self.base_url}/chat/completions",
                json=body,
                headers=self._headers(),
                timeout=120,
            )
            r.raise_for_status()
            data = r.json()

        # Decrypt response content if encrypted
        if self.e2e and data.get("ocip_encrypted_content"):
            payload = EncryptedPayload.from_dict(data["ocip_encrypted_content"])
            content = decrypt_from_sender(payload, self._keypair.private_key)
            data["choices"][0]["message"]["content"] = content
            del data["ocip_encrypted_content"]

        return data

    def chat_stream(
        self,
        messages: list[dict],
        model: str = "default",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        preference: str = "balanced",
        **kwargs,
    ):
        """Streaming chat completion. Yields decrypted token strings."""
        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
            "ocip_preference": preference,
            **kwargs,
        }
        if self.e2e:
            body["ocip_consumer_public_key"] = self.public_key_b64

        with httpx.Client() as client:
            with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=body,
                headers=self._headers(),
                timeout=120,
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        return

                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue

                    # Check for encrypted token
                    encrypted_token = chunk.get("ocip_encrypted_token")
                    if encrypted_token:
                        enc = EncryptedPayload.from_dict(encrypted_token)
                        token = decrypt_from_sender(enc, self._keypair.private_key)
                        yield token
                    else:
                        # Plaintext fallback
                        content = (
                            chunk.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content")
                        )
                        if content:
                            yield content

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
