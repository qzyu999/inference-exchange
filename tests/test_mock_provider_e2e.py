"""End to end: coordinator + mock provider over a real WebSocket."""

import asyncio
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from inference_exchange.config import ProviderConfig
from inference_exchange.coordinator.main import create_app
from inference_exchange.provider.agent import ProviderAgent
from inference_exchange.provider.mock_engine import MockEngine


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait(cond, timeout: float = 10.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cond():
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.05)
    return False


class Coordinator:
    def __init__(self, port: int):
        self.port = port
        self.base = f"http://127.0.0.1:{port}"

    def start(self):
        self._server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=self.port, log_level="warning"))
        self._thread = threading.Thread(target=self._server.run, daemon=True)
        self._thread.start()
        assert _wait(lambda: httpx.get(f"{self.base}/health").status_code == 200)

    def stop(self):
        self._server.should_exit = True
        self._thread.join(timeout=5)

    def provider_count(self) -> int:
        return httpx.get(f"{self.base}/health").json()["providers"]


@pytest.fixture
def stack(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    coord = Coordinator(_free_port())
    coord.start()
    agent = ProviderAgent(
        ProviderConfig(coordinator_url=f"ws://127.0.0.1:{coord.port}/ws/provider", provider_name="mock-a"),
        MockEngine(model_name="mock-model", tps=0),
        price_per_mtok_output=0.10,
    )
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_until_complete, args=(agent.run(),), daemon=True).start()
    assert _wait(lambda: coord.provider_count() >= 1)
    yield coord
    agent._running = False
    coord.stop()


def test_chat_through_mock_provider_is_served_and_billed(stack):
    base = stack.base
    key = httpx.get(f"{base}/health?include_key=1").json()["default_api_key"]
    headers = {"authorization": f"Bearer {key}"}
    before = httpx.get(f"{base}/v1/exchange/balance", headers=headers).json()["balance_usd"]

    r = httpx.post(f"{base}/v1/chat/completions", headers=headers, timeout=10, json={
        "model": "mock-model",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": False,
        "ocip_min_confidence": "open",
    })
    assert r.status_code == 200, r.text
    assert "You said: ping" in r.json()["choices"][0]["message"]["content"]

    # Billing fires on InferenceDone, which can land just after the response
    balance = lambda: httpx.get(f"{base}/v1/exchange/balance", headers=headers).json()["balance_usd"]
    assert _wait(lambda: balance() < before, timeout=3)


def test_provider_reregisters_after_coordinator_restart(stack):
    stack.stop()
    stack.start()
    # Agent retries every 5s after a lost connection
    assert _wait(lambda: stack.provider_count() == 1, timeout=12)
