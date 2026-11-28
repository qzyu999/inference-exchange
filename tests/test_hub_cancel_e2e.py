"""A client that leaves mid-stream frees the slot and cancels the provider (MUSE-017).

Real coordinator over real HTTP and WebSocket. The provider is a raw WebSocket
client that sends one chunk and then waits, as a slow model would.
"""

import asyncio
import json
import threading

import httpx
import pytest
import websockets

from inference_exchange.shared.protocol import (
    InferenceResponseChunk,
    ProviderCapabilities,
    RegisterMessage,
    TrustLevel,
)
from test_mock_provider_e2e import Coordinator, _free_port, _wait


@pytest.fixture
def coord(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    c = Coordinator(_free_port())
    c.start()
    yield c
    c.stop()


class SlowProvider:
    """Registers, answers each request with one chunk, then records what it receives."""

    def __init__(self, port: int):
        self.url = f"ws://127.0.0.1:{port}/ws/provider"
        self.received: list[dict] = []
        self.ready = threading.Event()
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_until_complete, args=(self._run(),), daemon=True).start()

    async def _run(self):
        async with websockets.connect(self.url) as ws:
            reg = RegisterMessage(
                provider_name="slow", capabilities=ProviderCapabilities(
                    models=["slow-model"], trust_level=TrustLevel.OPEN, max_concurrent=1))
            await ws.send(reg.model_dump_json())
            await ws.recv()  # registered
            self.ready.set()
            async for raw in ws:
                msg = json.loads(raw)
                self.received.append(msg)
                if msg["type"] == "inference_request":
                    await ws.send(InferenceResponseChunk(request_id=msg["request_id"], token="hello").model_dump_json())


def test_client_disconnect_cancels_provider_and_frees_its_slot(coord):
    provider = SlowProvider(coord.port)
    assert provider.ready.wait(10)
    key = httpx.get(f"{coord.base}/health?include_key=1").json()["default_api_key"]
    body = {"model": "slow-model", "messages": [{"role": "user", "content": "hi"}],
            "stream": True, "ocip_min_confidence": "open"}

    with httpx.Client(timeout=10) as client:
        with client.stream("POST", f"{coord.base}/v1/chat/completions",
                           headers={"authorization": f"Bearer {key}"}, json=body) as r:
            assert r.status_code == 200
            for line in r.iter_lines():
                if "hello" in line:
                    break  # first token arrived; now leave
    # Leaving closed the stream: the coordinator must cancel the provider's job.
    assert _wait(lambda: any(m["type"] == "cancel_request" for m in provider.received), timeout=5)
    request_id = next(m["request_id"] for m in provider.received if m["type"] == "inference_request")
    assert {"type": "cancel_request", "request_id": request_id} in provider.received

    # The slot came back: a second request is dispatched, not queued until timeout.
    providers = httpx.get(f"{coord.base}/v1/exchange/providers").json()
    slow = next(p for p in providers.get("providers", providers) if p.get("name") == "slow")
    assert slow["active_requests"] == 0
