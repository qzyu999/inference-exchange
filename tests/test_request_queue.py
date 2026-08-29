"""Tests for request queuing with timeout.

When all providers are at capacity, requests queue instead of getting an
immediate 503.  When a provider frees up, the oldest queued request is
dispatched automatically (FIFO).

Run with: .venv\\Scripts\\python -m pytest tests/test_request_queue.py -v
"""

import asyncio
from unittest.mock import AsyncMock

import pytest

from inference_exchange.coordinator.provider_hub import (
    ConnectedProvider,
    PendingRequest,
    ProviderHub,
)
from inference_exchange.shared.protocol import (
    InferenceDone,
    InferenceError,
    InferenceRequest,
    MessageType,
    ProviderCapabilities,
    TrustLevel,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_hub(max_depth: int = 50, timeout: float = 30.0) -> ProviderHub:
    hub = ProviderHub()
    hub.QUEUE_MAX_DEPTH = max_depth
    hub.QUEUE_TIMEOUT_SECONDS = timeout
    # Recreate the queue with the new maxsize
    hub._pending_queue = asyncio.Queue(maxsize=max_depth)
    return hub


def _add_provider(
    hub: ProviderHub,
    provider_id: str = "p1",
    models: list[str] | None = None,
    max_concurrent: int = 1,
) -> ConnectedProvider:
    """Register a provider with a mock WS that is at zero load."""
    ws = AsyncMock()
    caps = ProviderCapabilities(
        models=models or ["test-model"],
        max_concurrent=max_concurrent,
        trust_level=TrustLevel.OPEN,
        hardware="test-cpu",
        measured_tps=10.0,
    )
    provider = ConnectedProvider(
        provider_id=provider_id,
        name=f"test-{provider_id}",
        ws=ws,
        capabilities=caps,
    )
    hub._providers[provider_id] = provider
    return provider


def _make_inference_req(request_id: str = "req-1") -> InferenceRequest:
    return InferenceRequest(
        request_id=request_id,
        model="test-model",
        messages=[{"role": "user", "content": "hello"}],
    )


# ---------------------------------------------------------------------------
# 1. Request queues when no provider available
# ---------------------------------------------------------------------------


class TestEnqueueRequest:
    def test_enqueue_returns_pending_with_unset_event(self):
        """enqueue_request puts the request in the queue and returns a PendingRequest."""
        hub = _make_hub()
        req = _make_inference_req("req-1")

        pending = hub.enqueue_request(req, model="test-model")

        assert isinstance(pending, PendingRequest)
        assert pending.request_id == "req-1"
        assert not pending.event.is_set()
        assert pending.provider is None
        assert hub.pending_queue_size == 1

    def test_enqueue_multiple_fifo(self):
        """Multiple enqueued requests are stored in FIFO order."""
        hub = _make_hub()

        ids = []
        for i in range(5):
            req = _make_inference_req(f"req-{i}")
            hub.enqueue_request(req, model="test-model")
            ids.append(f"req-{i}")

        assert hub.pending_queue_size == 5

        # Drain and verify order
        drained = []
        while not hub._pending_queue.empty():
            drained.append(hub._pending_queue.get_nowait().request_id)
        assert drained == ids

    def test_enqueue_preserves_routing_constraints(self):
        """Routing constraints are stored on the PendingRequest."""
        hub = _make_hub()
        req = _make_inference_req("req-1")

        pending = hub.enqueue_request(
            req,
            model="llama-3-8b",
            preference="cheapest",
            min_confidence="hardened",
            max_price=0.50,
            session_id="sess-42",
        )

        assert pending.model == "llama-3-8b"
        assert pending.preference == "cheapest"
        assert pending.min_confidence == "hardened"
        assert pending.max_price == 0.50
        assert pending.session_id == "sess-42"


# ---------------------------------------------------------------------------
# 2. Queued request gets dispatched when provider frees up
# ---------------------------------------------------------------------------


class TestQueueDispatch:
    @pytest.mark.asyncio
    async def test_dispatch_on_inference_done(self):
        """When a provider completes a request, the oldest queued request is dispatched."""
        hub = _make_hub()
        provider = _add_provider(hub, "p1", max_concurrent=1)

        # Saturate the provider (1 active = at capacity)
        provider.active_requests = 1
        active_req = _make_inference_req("active-req")
        hub.create_response_queue("active-req")
        hub._request_to_provider["active-req"] = "p1"

        # Enqueue a pending request
        pending_req = _make_inference_req("pending-req")
        pending = hub.enqueue_request(pending_req, model="test-model")

        assert not pending.event.is_set()

        # Simulate InferenceDone arriving for the active request
        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "active-req",
            "tokens_generated": 10,
            "time_seconds": 1.0,
        })

        # Give the ensure_future a chance to run
        await asyncio.sleep(0.05)

        # The pending request should have been dispatched
        assert pending.event.is_set()
        assert pending.provider is not None
        assert pending.provider.provider_id == "p1"
        assert hub.pending_queue_size == 0

    @pytest.mark.asyncio
    async def test_dispatch_on_inference_error(self):
        """Queue dispatch also fires when a request errors (provider frees a slot)."""
        hub = _make_hub()
        provider = _add_provider(hub, "p1", max_concurrent=1)
        provider.active_requests = 1
        hub.create_response_queue("active-req")
        hub._request_to_provider["active-req"] = "p1"

        pending_req = _make_inference_req("pending-req")
        pending = hub.enqueue_request(pending_req, model="test-model")

        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_ERROR,
            "request_id": "active-req",
            "error": "oom",
        })

        await asyncio.sleep(0.05)

        assert pending.event.is_set()
        assert pending.provider is not None

    @pytest.mark.asyncio
    async def test_no_dispatch_when_still_at_capacity(self):
        """If the provider is still at capacity after completing one request, don't dispatch."""
        hub = _make_hub()
        provider = _add_provider(hub, "p1", max_concurrent=1)
        provider.active_requests = 2  # Over-committed (shouldn't happen, but be safe)
        hub.create_response_queue("active-req")
        hub._request_to_provider["active-req"] = "p1"

        pending_req = _make_inference_req("pending-req")
        pending = hub.enqueue_request(pending_req, model="test-model")

        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "active-req",
            "tokens_generated": 10,
            "time_seconds": 1.0,
        })

        await asyncio.sleep(0.05)

        # Provider still at capacity (1 active, 1 max) so no dispatch
        assert not pending.event.is_set()
        assert hub.pending_queue_size == 1


# ---------------------------------------------------------------------------
# 3. Timeout after configured seconds returns 503
# ---------------------------------------------------------------------------


class TestQueueTimeout:
    @pytest.mark.asyncio
    async def test_event_times_out(self):
        """A queued request that never gets a provider times out."""
        hub = _make_hub(timeout=0.1)  # Very short timeout for test
        req = _make_inference_req("req-1")
        pending = hub.enqueue_request(req, model="test-model")

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(pending.event.wait(), timeout=0.1)

    @pytest.mark.asyncio
    async def test_event_resolves_before_timeout(self):
        """If a provider is assigned before timeout, the event resolves."""
        hub = _make_hub(timeout=5.0)
        req = _make_inference_req("req-1")
        pending = hub.enqueue_request(req, model="test-model")

        # Simulate dispatch after a small delay
        async def assign_later():
            await asyncio.sleep(0.05)
            pending.provider = _add_provider(hub, "p1")
            pending.event.set()

        asyncio.ensure_future(assign_later())

        await asyncio.wait_for(pending.event.wait(), timeout=2.0)
        assert pending.provider is not None


# ---------------------------------------------------------------------------
# 4. Queue full returns immediate 503
# ---------------------------------------------------------------------------


class TestQueueFull:
    def test_queue_full_raises(self):
        """Enqueuing beyond max depth raises QueueFull."""
        hub = _make_hub(max_depth=3)

        for i in range(3):
            hub.enqueue_request(_make_inference_req(f"req-{i}"), model="test-model")

        with pytest.raises(asyncio.QueueFull):
            hub.enqueue_request(_make_inference_req("req-overflow"), model="test-model")

    def test_queue_accepts_after_drain(self):
        """After a dispatch drains one item, new requests can be enqueued."""
        hub = _make_hub(max_depth=2)

        hub.enqueue_request(_make_inference_req("req-0"), model="test-model")
        hub.enqueue_request(_make_inference_req("req-1"), model="test-model")

        # Manually drain one
        hub._pending_queue.get_nowait()

        # Now one more should fit
        hub.enqueue_request(_make_inference_req("req-2"), model="test-model")
        assert hub.pending_queue_size == 2


# ---------------------------------------------------------------------------
# 5. Multiple queued requests dispatched in FIFO order
# ---------------------------------------------------------------------------


class TestFIFODispatch:
    @pytest.mark.asyncio
    async def test_fifo_dispatch_order(self):
        """Multiple queued requests are dispatched oldest-first as providers free up."""
        hub = _make_hub()
        provider = _add_provider(hub, "p1", max_concurrent=1)
        provider.active_requests = 1

        # Set up the in-flight request
        hub.create_response_queue("active-req")
        hub._request_to_provider["active-req"] = "p1"

        # Enqueue 3 requests in order
        pendings = []
        for i in range(3):
            req = _make_inference_req(f"queued-{i}")
            p = hub.enqueue_request(req, model="test-model")
            pendings.append(p)

        # Complete the active request — should dispatch queued-0
        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "active-req",
            "tokens_generated": 5,
            "time_seconds": 0.5,
        })
        await asyncio.sleep(0.05)

        assert pendings[0].event.is_set()
        assert not pendings[1].event.is_set()
        assert not pendings[2].event.is_set()
        assert pendings[0].provider.provider_id == "p1"

        # Simulate that queued-0 was sent and is now in-flight
        provider.active_requests = 1
        hub.create_response_queue("queued-0")
        hub._request_to_provider["queued-0"] = "p1"

        # Complete queued-0 — should dispatch queued-1
        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "queued-0",
            "tokens_generated": 3,
            "time_seconds": 0.3,
        })
        await asyncio.sleep(0.05)

        assert pendings[1].event.is_set()
        assert not pendings[2].event.is_set()
        assert pendings[1].provider.provider_id == "p1"

    @pytest.mark.asyncio
    async def test_model_mismatch_skips_to_next(self):
        """If the freed provider can't serve the first queued model, skip to the next."""
        hub = _make_hub()
        # p1 serves model-a, p2 serves model-b
        p1 = _add_provider(hub, "p1", models=["model-a"], max_concurrent=1)
        p1.active_requests = 1
        hub.create_response_queue("active-p1")
        hub._request_to_provider["active-p1"] = "p1"

        # Queue: first wants model-b (p1 can't serve), second wants model-a (p1 can serve)
        req_b = InferenceRequest(
            request_id="want-b",
            model="model-b",
            messages=[{"role": "user", "content": "hi"}],
        )
        req_a = InferenceRequest(
            request_id="want-a",
            model="model-a",
            messages=[{"role": "user", "content": "hi"}],
        )
        pending_b = hub.enqueue_request(req_b, model="model-b")
        pending_a = hub.enqueue_request(req_a, model="model-a")

        # p1 frees up
        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "active-p1",
            "tokens_generated": 1,
            "time_seconds": 0.1,
        })
        await asyncio.sleep(0.05)

        # pending_b stays queued (no provider for model-b), pending_a gets dispatched
        assert not pending_b.event.is_set()
        assert pending_a.event.is_set()
        assert pending_a.provider.provider_id == "p1"
        # pending_b is still in the queue
        assert hub.pending_queue_size == 1

    @pytest.mark.asyncio
    async def test_dispatch_across_multiple_providers(self):
        """Dispatch uses any available provider, not just the one that freed up."""
        hub = _make_hub()
        p1 = _add_provider(hub, "p1", max_concurrent=1)
        p2 = _add_provider(hub, "p2", max_concurrent=1)
        p1.active_requests = 1
        p2.active_requests = 0  # p2 is idle but wasn't checked because no trigger

        hub.create_response_queue("active-p1")
        hub._request_to_provider["active-p1"] = "p1"

        req = _make_inference_req("queued-1")
        pending = hub.enqueue_request(req, model="test-model")

        # p1 completes — dispatch should find p2 idle (or p1 now idle)
        hub.handle_provider_message("p1", {
            "type": MessageType.INFERENCE_DONE,
            "request_id": "active-p1",
            "tokens_generated": 1,
            "time_seconds": 0.1,
        })
        await asyncio.sleep(0.05)

        assert pending.event.is_set()
        assert pending.provider is not None
        # Either p1 or p2 could be chosen (both have capacity now)
        assert pending.provider.provider_id in ("p1", "p2")
