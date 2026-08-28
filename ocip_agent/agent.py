"""OCIP Agent — network relay between coordinator and isolated inference server.

This is the "middleman" process:
1. Connects to coordinator via WebSocket (outbound, works behind NAT)
2. Receives encrypted inference requests
3. Decrypts using X25519 private key
4. Forwards plaintext to the local OCIP inference server (localhost:9999)
5. Streams tokens back from inference server
6. Encrypts response tokens and sends to coordinator

The decryption happens HERE (not in the inference server).
The inference server never sees encrypted data — it gets plaintext over localhost.
"""

import asyncio
import json
import logging
import time

import httpx
import websockets

from inference_exchange.shared.crypto import (
    KeyPair,
    EncryptedPayload,
    decrypt_json,
)
from inference_exchange.shared.protocol import (
    HeartbeatMessage,
    InferenceDone,
    InferenceError,
    InferenceRequest,
    InferenceResponseChunk,
    MessageType,
    ProviderCapabilities,
    RegisterMessage,
    TrustLevel,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ocip-agent] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class OCIPAgent:
    """Network-facing OCIP agent that relays to isolated inference server."""

    def __init__(
        self,
        coordinator_url: str = "ws://localhost:8000/ws/provider",
        inference_url: str = "http://127.0.0.1:9999",
        provider_name: str = "ocip-provider",
        price_output: float = 0.15,
        trust_level: str = "hardened",
    ):
        self.coordinator_url = coordinator_url
        self.inference_url = inference_url
        self.provider_name = provider_name
        self.price_output = price_output
        self.trust_level = trust_level
        self._keypair = KeyPair()
        self._active_requests = 0
        self._model_identity: dict | None = None

        logger.info(f"🔐 Encryption key: {self._keypair.public_key_b64[:16]}...")

    async def _fetch_inference_identity(self) -> dict:
        """Fetch model identity from the inference server."""
        async with httpx.AsyncClient() as client:
            for attempt in range(10):
                try:
                    r = await client.get(f"{self.inference_url}/identity", timeout=5)
                    if r.status_code == 200:
                        return r.json()
                except (httpx.ConnectError, httpx.ReadTimeout):
                    pass
                logger.info(f"Waiting for inference server... (attempt {attempt + 1})")
                await asyncio.sleep(2)
            raise RuntimeError("Inference server not reachable at " + self.inference_url)

    async def run(self):
        """Main loop — connect to coordinator, relay requests."""
        # First, connect to the inference server and get model identity
        logger.info(f"Connecting to inference server: {self.inference_url}")
        self._model_identity = await self._fetch_inference_identity()
        logger.info(f"Inference server reports: {self._model_identity['name']} ({self._model_identity['architecture']})")

        # Connect to coordinator
        while True:
            try:
                await self._connect_and_serve()
            except (websockets.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                logger.warning(f"Connection lost: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Error: {e}. Reconnecting in 10s...")
                await asyncio.sleep(10)

    async def _connect_and_serve(self):
        """Connect to coordinator and handle messages."""
        logger.info(f"Connecting to coordinator: {self.coordinator_url}")

        async with websockets.connect(self.coordinator_url) as ws:
            logger.info("Connected to coordinator")

            # Register with model identity from inference server
            reg = RegisterMessage(
                provider_name=self.provider_name,
                capabilities=ProviderCapabilities(
                    models=[self._model_identity["name"], "default"],
                    max_concurrent=2,
                    trust_level=TrustLevel(self.trust_level),
                    hardware="ocip-hardened",
                    measured_tps=0,
                    price_per_mtok_input=0.05,
                    price_per_mtok_output=self.price_output,
                ),
                encryption_public_key=self._keypair.public_key_b64,
            )
            await ws.send(reg.model_dump_json())
            logger.info(f"Registered: {self.provider_name} (model={self._model_identity['name']})")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(self._heartbeat_loop(ws))

            try:
                async for raw in ws:
                    data = json.loads(raw)
                    msg_type = data.get("type")

                    if msg_type == MessageType.INFERENCE_REQUEST:
                        req = InferenceRequest(**data)
                        asyncio.create_task(self._handle_request(ws, req))
                    elif msg_type == MessageType.CANCEL_REQUEST:
                        logger.info(f"Cancel: {data.get('request_id', '')[:8]}")
            finally:
                heartbeat_task.cancel()

    async def _handle_request(self, ws, req: InferenceRequest):
        """Handle an inference request: decrypt → forward to server → stream back."""
        self._active_requests += 1
        start = time.time()
        tokens = 0
        request_id = req.request_id

        logger.info(f"[{request_id[:8]}] Request received")

        try:
            # Step 1: Decrypt if E2E encrypted
            if req.encrypted_body:
                payload = EncryptedPayload.from_dict(req.encrypted_body)
                decrypted = decrypt_json(payload, self._keypair.private_key)
                messages = decrypted["messages"]
                logger.info(f"[{request_id[:8]}] 🔐 Decrypted E2E payload")
            elif req.messages:
                messages = req.messages
            else:
                raise ValueError("No messages in request")

            # Step 2: Forward to inference server (plaintext over localhost)
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.inference_url}/v1/chat/completions",
                    json={
                        "messages": messages,
                        "max_tokens": req.max_tokens,
                        "temperature": req.temperature,
                        "stream": True,
                    },
                    timeout=120,
                )

                # Step 3: Stream tokens back to coordinator
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break

                    try:
                        chunk_data = json.loads(data_str)
                        content = chunk_data.get("choices", [{}])[0].get("delta", {}).get("content")
                        if content:
                            tokens += 1
                            chunk = InferenceResponseChunk(
                                request_id=request_id,
                                token=content,
                            )
                            await ws.send(chunk.model_dump_json())
                    except json.JSONDecodeError:
                        continue

            # Step 4: Send done
            elapsed = time.time() - start
            done = InferenceDone(
                request_id=request_id,
                tokens_generated=tokens,
                time_seconds=elapsed,
            )
            await ws.send(done.model_dump_json())

            tps = tokens / elapsed if elapsed > 0 else 0
            logger.info(f"[{request_id[:8]}] Done: {tokens} tokens in {elapsed:.1f}s ({tps:.1f} tok/s)")

        except Exception as e:
            logger.error(f"[{request_id[:8]}] Error: {e}")
            error = InferenceError(request_id=request_id, error=str(e))
            try:
                await ws.send(error.model_dump_json())
            except Exception:
                pass
        finally:
            self._active_requests -= 1

    async def _heartbeat_loop(self, ws):
        """Send periodic heartbeats."""
        while True:
            try:
                hb = HeartbeatMessage(active_requests=self._active_requests)
                await ws.send(hb.model_dump_json())
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                break
            except Exception:
                break


def main():
    import argparse

    parser = argparse.ArgumentParser(description="OCIP Agent (network relay)")
    parser.add_argument("--coordinator", default="ws://localhost:8000/ws/provider")
    parser.add_argument("--inference-server", default="http://127.0.0.1:9999")
    parser.add_argument("--name", default="ocip-hardened-node")
    parser.add_argument("--price-output", type=float, default=0.15)
    parser.add_argument("--trust", default="hardened")
    args = parser.parse_args()

    agent = OCIPAgent(
        coordinator_url=args.coordinator,
        inference_url=args.inference_server,
        provider_name=args.name,
        price_output=args.price_output,
        trust_level=args.trust,
    )

    logger.info("=" * 50)
    logger.info("  OCIP AGENT (network relay)")
    logger.info(f"  Coordinator: {args.coordinator}")
    logger.info(f"  Inference:   {args.inference_server}")
    logger.info(f"  Trust level: {args.trust}")
    logger.info("=" * 50)

    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
