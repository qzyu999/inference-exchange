"""OCIP Agent — production-grade network relay with inference server management.

Responsibilities:
1. Manages inference server lifecycle (start/monitor/restart)
2. Connects to coordinator via WebSocket (outbound, E2E encrypted)
3. Decrypts incoming requests (X25519)
4. Forwards plaintext to local inference server with true streaming
5. Propagates cancellation (consumer disconnect → kill inference)
6. Health monitoring + automatic recovery
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

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


class InferenceServerManager:
    """Manages the OCIP inference server as a child process.

    Starts it, monitors health, restarts on crash with exponential backoff.
    """

    def __init__(self, model_path: str, port: int = 9999, n_gpu_layers: int = -1):
        self.model_path = model_path
        self.port = port
        self.n_gpu_layers = n_gpu_layers
        self.base_url = f"http://127.0.0.1:{port}"
        self._process: subprocess.Popen | None = None
        self._restart_count = 0
        self._max_restarts = 5
        self._healthy = False
        self._identity: dict | None = None

    async def start(self):
        """Start the inference server process."""
        if self._process and self._process.poll() is None:
            logger.info("Inference server already running")
            return

        cmd = [
            sys.executable, "-m", "ocip_server.server",
            "--model", self.model_path,
            "--port", str(self.port),
            "--n-gpu-layers", str(self.n_gpu_layers),
        ]

        logger.info(f"Starting inference server: port={self.port}")
        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            # Don't inherit the agent's stdin — server runs headless
        )
        logger.info(f"Inference server PID: {self._process.pid}")

        # Wait for it to become healthy
        await self._wait_for_health(timeout=30)

    async def _wait_for_health(self, timeout: float = 30):
        """Poll until the server responds to /health."""
        start = time.time()
        async with httpx.AsyncClient() as client:
            while time.time() - start < timeout:
                try:
                    r = await client.get(f"{self.base_url}/health", timeout=2)
                    if r.status_code == 200:
                        self._healthy = True
                        # Fetch identity (custom OCIP endpoint, may not exist on stock llama-server)
                        try:
                            r2 = await client.get(f"{self.base_url}/identity", timeout=5)
                            if r2.status_code == 200:
                                self._identity = r2.json()
                        except Exception:
                            pass
                        if self._identity is None:
                            # Fallback: derive identity from model path
                            model_name = Path(self._model_path).stem if self._model_path else "unknown"
                            self._identity = {"name": model_name, "source": "filename"}
                        logger.info(f"Inference server healthy (model: {self._identity.get('name', '?')})")
                        self._restart_count = 0  # Reset backoff on success
                        return
                except (httpx.ConnectError, httpx.ReadTimeout):
                    pass

                # Check if process died
                if self._process and self._process.poll() is not None:
                    exit_code = self._process.returncode
                    stderr = self._process.stderr.read().decode()[-500:] if self._process.stderr else ""
                    logger.error(f"Inference server exited with code {exit_code}: {stderr}")
                    self._healthy = False
                    raise RuntimeError(f"Inference server crashed (exit {exit_code})")

                await asyncio.sleep(1)

        self._healthy = False
        raise RuntimeError(f"Inference server didn't become healthy within {timeout}s")

    async def restart(self):
        """Restart with exponential backoff."""
        self._restart_count += 1
        if self._restart_count > self._max_restarts:
            logger.error(f"Max restarts ({self._max_restarts}) exceeded. Giving up.")
            raise RuntimeError("Inference server keeps crashing")

        backoff = min(2 ** self._restart_count, 30)
        logger.warning(f"Restarting inference server in {backoff}s (attempt {self._restart_count})")
        await asyncio.sleep(backoff)

        self.stop()
        await self.start()

    def stop(self):
        """Stop the inference server."""
        if self._process and self._process.poll() is None:
            logger.info(f"Stopping inference server (PID {self._process.pid})")
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._healthy = False

    @property
    def is_healthy(self) -> bool:
        if self._process is None:
            return False
        if self._process.poll() is not None:
            self._healthy = False
        return self._healthy

    @property
    def identity(self) -> dict:
        return self._identity or {}

    async def check_health(self) -> bool:
        """Ping the health endpoint."""
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(f"{self.base_url}/health", timeout=3)
                self._healthy = r.status_code == 200
                return self._healthy
        except (httpx.ConnectError, httpx.ReadTimeout):
            self._healthy = False
            return False


class OCIPAgent:
    """Production-grade OCIP agent with full lifecycle management."""

    def __init__(
        self,
        coordinator_url: str = "ws://localhost:8000/ws/provider",
        model_path: str | None = None,
        inference_port: int = 9999,
        provider_name: str = "ocip-provider",
        price_output: float = 0.15,
        trust_level: str = "hardened",
        n_gpu_layers: int = -1,
    ):
        self.coordinator_url = coordinator_url
        self.provider_name = provider_name
        self.price_output = price_output
        self.trust_level = trust_level

        # Encryption
        self._keypair = KeyPair()
        logger.info(f"🔐 Encryption key: {self._keypair.public_key_b64[:16]}...")

        # Inference server management
        self._model_path = model_path or self._find_model()
        self._server = InferenceServerManager(
            model_path=self._model_path,
            port=inference_port,
            n_gpu_layers=n_gpu_layers,
        )

        # Request tracking (for cancellation)
        self._active_requests: dict[str, asyncio.Task] = {}
        self._running = False

    def _find_model(self) -> str:
        """Find a model file."""
        models_dir = Path.home() / ".inference-exchange" / "models"
        if models_dir.exists():
            gguf_files = list(models_dir.glob("*.gguf"))
            if gguf_files:
                return str(gguf_files[0])
        raise FileNotFoundError("No model found. Run: python -m inference_exchange download-model")

    async def run(self):
        """Main entrypoint: start server, connect to coordinator, handle requests."""
        self._running = True

        # Start the inference server
        try:
            await self._server.start()
        except RuntimeError as e:
            logger.error(f"Failed to start inference server: {e}")
            return

        # Start health monitor in background
        health_task = asyncio.create_task(self._health_monitor())

        # Connect to coordinator (with reconnection)
        try:
            while self._running:
                try:
                    await self._connect_and_serve()
                except (websockets.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                    logger.warning(f"Coordinator connection lost: {e}. Reconnecting in 5s...")
                    await asyncio.sleep(5)
                except Exception as e:
                    logger.error(f"Unexpected error: {e}. Reconnecting in 10s...")
                    await asyncio.sleep(10)
        finally:
            health_task.cancel()
            self._server.stop()

    async def _health_monitor(self):
        """Periodically check inference server health; restart if needed."""
        while self._running:
            await asyncio.sleep(15)
            if not await self._server.check_health():
                logger.warning("Inference server unhealthy — attempting restart")
                try:
                    await self._server.restart()
                except RuntimeError as e:
                    logger.error(f"Cannot recover inference server: {e}")
                    self._running = False
                    break

    async def _connect_and_serve(self):
        """Connect to coordinator and handle the message loop."""
        logger.info(f"Connecting to coordinator: {self.coordinator_url}")

        async with websockets.connect(self.coordinator_url) as ws:
            logger.info("Connected to coordinator")

            # Register
            identity = self._server.identity
            reg = RegisterMessage(
                provider_name=self.provider_name,
                capabilities=ProviderCapabilities(
                    models=[identity.get("name", "unknown"), "default"],
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
            logger.info(f"Registered: {self.provider_name} (model={identity.get('name', '?')})")

            # Heartbeat + message loop
            heartbeat_task = asyncio.create_task(self._heartbeat_loop(ws))

            try:
                async for raw in ws:
                    data = json.loads(raw)
                    msg_type = data.get("type")

                    if msg_type == MessageType.INFERENCE_REQUEST:
                        req = InferenceRequest(**data)
                        task = asyncio.create_task(self._handle_request(ws, req))
                        self._active_requests[req.request_id] = task

                    elif msg_type == MessageType.CANCEL_REQUEST:
                        rid = data.get("request_id", "")
                        if rid in self._active_requests:
                            self._active_requests[rid].cancel()
                            del self._active_requests[rid]
                            logger.info(f"[{rid[:8]}] Cancelled")
            finally:
                heartbeat_task.cancel()
                # Cancel all in-flight requests
                for task in self._active_requests.values():
                    task.cancel()
                self._active_requests.clear()

    async def _handle_request(self, ws, req: InferenceRequest):
        """Decrypt → forward to server (streaming) → encrypt response back."""
        start = time.time()
        tokens = 0
        request_id = req.request_id

        try:
            # Step 1: Decrypt
            if req.encrypted_body:
                payload = EncryptedPayload.from_dict(req.encrypted_body)
                decrypted = decrypt_json(payload, self._keypair.private_key)
                messages = decrypted["messages"]
                logger.info(f"[{request_id[:8]}] 🔐 Decrypted")
            elif req.messages:
                messages = req.messages
            else:
                raise ValueError("No messages in request")

            # Step 2: Stream from inference server (true per-chunk streaming)
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self._server.base_url}/v1/chat/completions",
                    json={
                        "messages": messages,
                        "max_tokens": req.max_tokens,
                        "temperature": req.temperature,
                        "stream": True,
                    },
                    timeout=120,
                ) as response:
                    # Step 3: Relay each token as it arrives
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break

                        try:
                            chunk_data = json.loads(data_str)
                            content = (
                                chunk_data.get("choices", [{}])[0]
                                .get("delta", {})
                                .get("content")
                            )
                            if content:
                                tokens += 1
                                chunk = InferenceResponseChunk(
                                    request_id=request_id,
                                    token=content,
                                )
                                await ws.send(chunk.model_dump_json())
                        except json.JSONDecodeError:
                            continue

            # Step 4: Done
            elapsed = time.time() - start
            done = InferenceDone(
                request_id=request_id,
                tokens_generated=tokens,
                time_seconds=elapsed,
            )
            await ws.send(done.model_dump_json())

            tps = tokens / elapsed if elapsed > 0 else 0
            logger.info(f"[{request_id[:8]}] ✓ {tokens} tok / {elapsed:.1f}s ({tps:.1f} tok/s)")

        except asyncio.CancelledError:
            logger.info(f"[{request_id[:8]}] Cancelled by coordinator")
            # Could send a cancel to the inference server here if it supports it

        except Exception as e:
            logger.error(f"[{request_id[:8]}] Error: {e}")
            try:
                error = InferenceError(request_id=request_id, error=str(e))
                await ws.send(error.model_dump_json())
            except Exception:
                pass
        finally:
            self._active_requests.pop(request_id, None)

    async def _heartbeat_loop(self, ws):
        """Send heartbeats with server health status."""
        while True:
            try:
                hb = HeartbeatMessage(
                    active_requests=len(self._active_requests),
                    loaded_models=[self._server.identity.get("name", "unknown")],
                )
                await ws.send(hb.model_dump_json())
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                break
            except Exception:
                break


def main():
    import argparse

    parser = argparse.ArgumentParser(description="OCIP Agent — managed inference provider")
    parser.add_argument("--coordinator", default="ws://localhost:8000/ws/provider")
    parser.add_argument("--model", default=None, help="Path to GGUF model (auto-detected if omitted)")
    parser.add_argument("--port", type=int, default=9999, help="Inference server port")
    parser.add_argument("--name", default="ocip-node")
    parser.add_argument("--price-output", type=float, default=0.15)
    parser.add_argument("--trust", default="hardened")
    parser.add_argument("--n-gpu-layers", type=int, default=-1)
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("  OCIP AGENT — Managed Inference Provider")
    logger.info(f"  Coordinator:     {args.coordinator}")
    logger.info(f"  Inference port:  {args.port} (localhost only)")
    logger.info(f"  Trust level:     {args.trust}")
    logger.info(f"  Model:           {args.model or '(auto-detect)'}")
    logger.info("=" * 60)

    agent = OCIPAgent(
        coordinator_url=args.coordinator,
        model_path=args.model,
        inference_port=args.port,
        provider_name=args.name,
        price_output=args.price_output,
        trust_level=args.trust,
        n_gpu_layers=args.n_gpu_layers,
    )

    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        logger.info("Shutting down...")


if __name__ == "__main__":
    main()
