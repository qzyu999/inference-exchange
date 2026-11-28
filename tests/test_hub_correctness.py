"""ProviderHub correctness (#297 slice 2; findings in #300).

Each test pins one defect: a foreign provider's frames, the callback installed
after the send, slots kept or double-counted, heartbeat overwriting the count,
and unbounded response queues. None of these depend on money.
"""

import asyncio
import json

import pytest

from inference_exchange.coordinator.provider_hub import ConnectedProvider, ProviderHub
from inference_exchange.shared.protocol import (
    HeartbeatMessage,
    InferenceDone,
    InferenceError,
    InferenceRequest,
    InferenceResponseChunk,
    ProviderCapabilities,
    TrustLevel,
)


class FakeSocket:
    """Records frames. `on_send` runs inside send_json, as a fast provider would reply."""

    def __init__(self):
        self.sent: list[dict] = []
        self.on_send = None
        self.fail = False

    async def send_json(self, data):
        if self.fail:
            raise ConnectionError("socket closed")
        self.sent.append(data)
        if self.on_send:
            self.on_send(data)

    async def close(self, code=1000, reason=""):
        pass


def add(hub: ProviderHub, pid: str, slots: int = 1) -> ConnectedProvider:
    p = ConnectedProvider(
        provider_id=pid, name=pid, ws=FakeSocket(),
        capabilities=ProviderCapabilities(models=["m"], trust_level=TrustLevel.OPEN, max_concurrent=slots),
    )
    hub._providers[pid] = p
    return p


def req(rid: str) -> InferenceRequest:
    return InferenceRequest(request_id=rid, model="m", messages=[{"role": "user", "content": "x"}])


def done(rid: str, tokens: int = 3) -> dict:
    return InferenceDone(request_id=rid, tokens_generated=tokens, input_tokens=2).model_dump()


def chunk(rid: str, token: str = "t") -> dict:
    return InferenceResponseChunk(request_id=rid, token=token).model_dump()


# --- MUSE-012: frame ownership ---------------------------------------------

async def test_foreign_provider_cannot_complete_or_bill_a_request():
    hub = ProviderHub()
    owner, intruder = add(hub, "owner"), add(hub, "intruder")
    billed = []
    queue = hub.start("r1", owner, on_done=billed.append)
    await hub.send_to_provider(owner, req("r1"))

    hub.handle_provider_message("intruder", chunk("r1", "forged"))
    hub.handle_provider_message("intruder", done("r1", tokens=1_000_000))
    assert billed == [] and queue.empty()
    assert owner.active_requests == 1  # the intruder freed nothing

    hub.handle_provider_message("owner", done("r1"))
    assert [d.tokens_generated for d in billed] == [3]
    assert intruder.active_requests == 0


async def test_frame_from_owner_after_reassignment_is_dropped():
    hub = ProviderHub()
    a = add(hub, "a")
    billed = []
    hub.start("r1", a, on_done=billed.append)
    await hub.send_to_provider(a, req("r1"))
    hub.finish("r1")
    hub.handle_provider_message("a", done("r1"))
    assert billed == []


# --- MUSE-016: queue and callback exist before the send ---------------------

async def test_done_during_send_is_billed_and_delivered():
    hub = ProviderHub()
    p = add(hub, "p")
    billed = []
    p.ws.on_send = lambda data: hub.handle_provider_message("p", done(data["request_id"]))
    queue = hub.start("r1", p, on_done=billed.append)
    await hub.send_to_provider(p, req("r1"))
    assert len(billed) == 1
    assert isinstance(queue.get_nowait(), InferenceDone)


async def test_duplicate_done_bills_once():
    hub = ProviderHub()
    p = add(hub, "p")
    billed = []
    hub.start("r1", p, on_done=billed.append)
    await hub.send_to_provider(p, req("r1"))
    hub.handle_provider_message("p", done("r1"))
    hub.handle_provider_message("p", done("r1"))
    assert len(billed) == 1
    assert p.active_requests == 0


# --- MUSE-017: a slot is released exactly once ------------------------------

async def test_cancel_after_send_releases_the_slot_and_tells_the_provider():
    hub = ProviderHub()
    p = add(hub, "p")
    hub.start("r1", p)
    await hub.send_to_provider(p, req("r1"))
    assert p.active_requests == 1
    await hub.cancel("r1")
    assert p.active_requests == 0
    assert p.ws.sent[-1] == {"type": "cancel_request", "request_id": "r1"}
    # A late frame after cancel neither frees a second slot nor bills.
    hub.handle_provider_message("p", done("r1"))
    assert p.active_requests == 0


async def test_failed_send_releases_the_slot_once():
    hub = ProviderHub()
    p = add(hub, "p")
    p.ws.fail = True
    hub.start("r1", p)
    with pytest.raises(ConnectionError):
        await hub.send_to_provider(p, req("r1"))
    hub.finish("r1")
    assert p.active_requests == 0


async def test_error_frame_releases_the_slot_once():
    hub = ProviderHub()
    p = add(hub, "p")
    queue = hub.start("r1", p)
    await hub.send_to_provider(p, req("r1"))
    err = InferenceError(request_id="r1", error="boom").model_dump()
    hub.handle_provider_message("p", err)
    hub.handle_provider_message("p", err)
    hub.finish("r1")
    assert p.active_requests == 0
    assert isinstance(queue.get_nowait(), InferenceError)


async def test_disconnect_fails_in_flight_requests_and_late_frames_do_nothing():
    hub = ProviderHub()
    p = add(hub, "p")
    billed = []
    queue = hub.start("r1", p, on_done=billed.append)
    await hub.send_to_provider(p, req("r1"))
    hub.disconnect_provider("p")
    assert isinstance(queue.get_nowait(), InferenceError)
    hub.handle_provider_message("p", done("r1"))
    assert billed == []


# --- MUSE-018: the hub owns the slot count -----------------------------------

async def test_heartbeat_cannot_free_or_inflate_slots():
    hub = ProviderHub()
    p = add(hub, "p", slots=2)
    hub.start("r1", p)
    await hub.send_to_provider(p, req("r1"))
    hub.handle_heartbeat("p", HeartbeatMessage(active_requests=0))
    assert p.active_requests == 1
    hub.handle_heartbeat("p", HeartbeatMessage(active_requests=99))
    assert p.active_requests == 1
    assert p.reported_active_requests == 99  # kept for display, never for routing


# --- MUSE-019: assignment reserves the slot ----------------------------------

async def test_two_queue_passes_cannot_assign_one_slot_twice():
    hub = ProviderHub()
    p = add(hub, "p", slots=1)
    w1 = hub.enqueue_request(req("w1"), model="m")
    w2 = hub.enqueue_request(req("w2"), model="m")
    await asyncio.gather(hub._try_dispatch_queued(), hub._try_dispatch_queued())
    assigned = [w for w in (w1, w2) if w.provider is not None]
    assert len(assigned) == 1
    assert p.active_requests == 1  # reserved at assignment, before any send
    # The winner sends without taking a second slot.
    hub.start(assigned[0].request_id, p, reserved=True)
    await hub.send_to_provider(p, assigned[0].inference_req)
    assert p.active_requests == 1


async def test_queued_waiter_that_times_out_returns_its_reserved_slot():
    hub = ProviderHub()
    p = add(hub, "p", slots=1)
    w = hub.enqueue_request(req("w1"), model="m")
    await hub._try_dispatch_queued()
    assert w.provider is p and p.active_requests == 1
    hub.abandon(w)  # the route gave up before sending
    assert p.active_requests == 0


# --- MUSE-038: bounded response queues --------------------------------------

async def test_response_queue_is_bounded_and_overflow_fails_the_request():
    hub = ProviderHub()
    p = add(hub, "p")
    queue = hub.start("r1", p)
    await hub.send_to_provider(p, req("r1"))
    for i in range(hub.RESPONSE_QUEUE_MAX + 50):
        hub.handle_provider_message("p", chunk("r1", str(i)))
    assert queue.qsize() <= hub.RESPONSE_QUEUE_MAX
    items = [queue.get_nowait() for _ in range(queue.qsize())]
    assert isinstance(items[-1], InferenceError) and items[-1].error == "response_overflow"
    assert p.active_requests == 0
    await asyncio.sleep(0)  # the cancel frame is sent from the event loop
    assert json.loads(json.dumps(p.ws.sent[-1])) == {"type": "cancel_request", "request_id": "r1"}


async def test_cancel_after_a_normal_finish_sends_no_frame():
    hub = ProviderHub()
    p = add(hub, "p")
    hub.start("r1", p)
    await hub.send_to_provider(p, req("r1"))
    hub.handle_provider_message("p", done("r1"))
    await hub.cancel("r1")  # the route's finally block
    assert [m["type"] for m in p.ws.sent] == ["inference_request"]


async def test_send_without_start_is_refused():
    hub = ProviderHub()
    p = add(hub, "p")
    with pytest.raises(RuntimeError, match="start"):
        await hub.send_to_provider(p, req("r1"))
    assert p.active_requests == 0
