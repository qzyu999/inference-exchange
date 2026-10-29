"""#173: permanent provider rejection shuts down the OCIP child; outages retry."""

import asyncio

import pytest
from websockets.exceptions import ConnectionClosedError
from websockets.frames import Close

from ocip_agent.agent import (
    OCIPAgent,
    PermanentProviderRejection,
    is_permanent_auth_rejection,
)


class FakeServer:
    def __init__(self, error=None):
        self.error = error
        self.started = 0
        self.stopped = 0

    async def start(self):
        self.started += 1
        if self.error:
            raise self.error

    def stop(self):
        self.stopped += 1


def close(code, reason):
    return ConnectionClosedError(Close(code, reason), None)


def agent_with_fake_server(error=None):
    # Avoid loading a GGUF: exercise only the run/reconnect lifecycle.
    agent = OCIPAgent.__new__(OCIPAgent)
    agent._running = False
    agent._server = FakeServer(error)

    async def health_monitor():
        await asyncio.Future()  # canceled in run() cleanup

    agent._health_monitor = health_monitor
    return agent


@pytest.mark.parametrize("reason", [
    "Invalid provider token",
    "Provider credential revoked",
    "Provider owner unavailable",
    "Provider credential no longer active",
    "Provider token in URL is disabled. Send Authorization: Bearer",
])
def test_known_credential_rejections_are_terminal(reason):
    assert is_permanent_auth_rejection(close(4003, reason))


@pytest.mark.parametrize("code,reason", [
    (4003, "Disconnected by operator"),
    (4003, "Other transient disconnect"),
    (1001, "server going away"),
    (1013, "try again later"),
    (4008, "Too many registration attempts"),
    (4003, "Provider credential revoked but with unrecognized text"),
])
def test_transient_close_not_mistaken_for_revocation(code, reason):
    assert not is_permanent_auth_rejection(close(code, reason))


def test_missing_received_close_frame_is_not_auth_rejection():
    # A locally sent close isn't an explicit coordinator authentication denial.
    assert not is_permanent_auth_rejection(ConnectionClosedError(None, None))
    assert not is_permanent_auth_rejection(
        ConnectionClosedError(None, Close(4003, "Invalid provider token"))
    )


@pytest.mark.asyncio
async def test_revoked_agent_stops_server_and_does_not_retry():
    agent = agent_with_fake_server()
    attempts = 0

    async def connect():
        nonlocal attempts
        attempts += 1
        raise close(4003, "Provider credential revoked")

    agent._connect_and_serve = connect
    with pytest.raises(PermanentProviderRejection):
        await asyncio.wait_for(agent.run(), timeout=1)
    assert attempts == 1
    assert agent._server.started == 1
    assert agent._server.stopped == 1
    assert agent._running is False


@pytest.mark.asyncio
async def test_transient_disconnect_retries_then_cleans_up(monkeypatch):
    agent = agent_with_fake_server()
    calls, delays = [], []

    async def connect():
        calls.append(True)
        if len(calls) == 1:
            raise close(4003, "Disconnected by operator")
        agent._running = False

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("ocip_agent.agent.asyncio.sleep", sleep)
    agent._connect_and_serve = connect
    await asyncio.wait_for(agent.run(), timeout=1)
    assert len(calls) == 2
    assert delays == [5]
    assert agent._server.stopped == 1


@pytest.mark.asyncio
async def test_model_start_failure_also_stops_child():
    agent = agent_with_fake_server(RuntimeError("failed"))
    await agent.run()
    assert agent._server.stopped == 1
    assert agent._running is False
