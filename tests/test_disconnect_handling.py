"""Tests for mid-stream provider disconnect handling.

Verifies that when a provider disconnects while requests are in-flight:
1. InferenceError is pushed to all orphaned response queues
2. The request_to_provider mapping is properly maintained
3. Reputation records disconnect events
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from inference_exchange.coordinator.provider_hub import ConnectedProvider, ProviderHub
from inference_exchange.coordinator.reputation import ReputationTracker, RequestOutcome
from inference_exchange.shared.protocol import (
    InferenceError,
    InferenceRequest,
    ProviderCapabilities,
    TrustLevel,
)


def _make_provider(hub: ProviderHub, provider_id: str = "provider-1") -> ConnectedProvider:
    """Create a ConnectedProvider with a mock WebSocket and register it in the hub."""
    ws = AsyncMock()
    caps = ProviderCapabilities(
        models=["test-model"],
        max_concurrent=4,
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


def _make_request(request_id: str = "req-1") -> InferenceRequest:
    return InferenceRequest(
        request_id=request_id,
        model="test-model",
        messages=[{"role": "user", "content": "hello"}],
    )


# ---------------------------------------------------------------------------
# request_to_provider mapping is maintained correctly
# ---------------------------------------------------------------------------

class TestRequestProviderMapping:
    @pytest.mark.asyncio
    async def test_send_records_mapping(self):
        """send_to_provider should record request_id → provider_id."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        req = _make_request("req-1")
        hub.create_response_queue("req-1")

        await hub.send_to_provider(provider, req)

        assert "req-1" in hub._request_to_provider
        assert hub._request_to_provider["req-1"] == "p1"

    @pytest.mark.asyncio
    async def test_remove_queue_cleans_mapping(self):
        """remove_response_queue should also remove the request_to_provider entry."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        req = _make_request("req-1")
        hub.create_response_queue("req-1")
        await hub.send_to_provider(provider, req)

        hub.remove_response_queue("req-1")

        assert "req-1" not in hub._request_to_provider

    @pytest.mark.asyncio
    async def test_multiple_requests_tracked(self):
        """Multiple in-flight requests to the same provider are all tracked."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")

        for i in range(3):
            req = _make_request(f"req-{i}")
            hub.create_response_queue(f"req-{i}")
            await hub.send_to_provider(provider, req)

        assert len(hub._request_to_provider) == 3
        for i in range(3):
            assert hub._request_to_provider[f"req-{i}"] == "p1"


# ---------------------------------------------------------------------------
# disconnect_provider pushes errors to in-flight request queues
# ---------------------------------------------------------------------------

class TestDisconnectPushesErrors:
    @pytest.mark.asyncio
    async def test_disconnect_pushes_error_to_queue(self):
        """Disconnecting a provider with an in-flight request pushes InferenceError."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        req = _make_request("req-1")
        queue = hub.create_response_queue("req-1")
        await hub.send_to_provider(provider, req)

        hub.disconnect_provider("p1")

        assert not queue.empty()
        msg = queue.get_nowait()
        assert isinstance(msg, InferenceError)
        assert msg.request_id == "req-1"
        assert msg.error == "provider_disconnected"

    @pytest.mark.asyncio
    async def test_disconnect_pushes_errors_to_all_queues(self):
        """All in-flight requests for the disconnecting provider get errors."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        queues = {}
        for i in range(3):
            req = _make_request(f"req-{i}")
            queues[f"req-{i}"] = hub.create_response_queue(f"req-{i}")
            await hub.send_to_provider(provider, req)

        hub.disconnect_provider("p1")

        for req_id, queue in queues.items():
            assert not queue.empty(), f"Queue for {req_id} should have an error"
            msg = queue.get_nowait()
            assert isinstance(msg, InferenceError)
            assert msg.error == "provider_disconnected"

    @pytest.mark.asyncio
    async def test_disconnect_returns_orphaned_request_ids(self):
        """disconnect_provider returns the list of orphaned request IDs."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        for i in range(2):
            req = _make_request(f"req-{i}")
            hub.create_response_queue(f"req-{i}")
            await hub.send_to_provider(provider, req)

        orphaned = hub.disconnect_provider("p1")
        assert sorted(orphaned) == ["req-0", "req-1"]

    @pytest.mark.asyncio
    async def test_disconnect_only_affects_own_requests(self):
        """Disconnecting provider-1 should not touch provider-2's requests."""
        hub = ProviderHub()
        p1 = _make_provider(hub, "p1")
        p2 = _make_provider(hub, "p2")

        q1 = hub.create_response_queue("req-p1")
        await hub.send_to_provider(p1, _make_request("req-p1"))

        q2 = hub.create_response_queue("req-p2")
        await hub.send_to_provider(p2, _make_request("req-p2"))

        hub.disconnect_provider("p1")

        # p1's queue gets an error
        assert not q1.empty()
        assert isinstance(q1.get_nowait(), InferenceError)

        # p2's queue is untouched
        assert q2.empty()
        assert "req-p2" in hub._request_to_provider

    def test_disconnect_with_no_inflight_is_clean(self):
        """Disconnecting a provider with no in-flight requests is a no-op for queues."""
        hub = ProviderHub()
        _make_provider(hub, "p1")

        orphaned = hub.disconnect_provider("p1")
        assert orphaned == []
        assert "p1" not in hub._providers

    def test_disconnect_unknown_provider_returns_empty(self):
        """Disconnecting an unknown provider_id returns empty list."""
        hub = ProviderHub()
        orphaned = hub.disconnect_provider("nonexistent")
        assert orphaned == []

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up_mapping(self):
        """After disconnect, orphaned request_ids are removed from _request_to_provider."""
        hub = ProviderHub()
        provider = _make_provider(hub, "p1")
        hub.create_response_queue("req-1")
        await hub.send_to_provider(provider, _make_request("req-1"))

        hub.disconnect_provider("p1")

        assert "req-1" not in hub._request_to_provider


# ---------------------------------------------------------------------------
# Reputation records disconnect events
# ---------------------------------------------------------------------------

class TestReputationDisconnect:
    def test_record_disconnect_decreases_score(self):
        """Recording a disconnect should decrease the provider's reputation."""
        tracker = ReputationTracker()
        # Give the provider enough history so the score is no longer neutral
        for _ in range(5):
            tracker.record_success("p1", latency_ms=200)
        score_before = tracker.get_score("p1")
        tracker.record_disconnect("p1")
        assert tracker.get_score("p1") < score_before

    def test_disconnect_counts_as_failure(self):
        """Disconnects increment total_failures."""
        tracker = ReputationTracker()
        tracker.record_disconnect("p1")
        rep = tracker.get_or_create("p1")
        assert rep.total_failures == 1
        assert rep.total_requests == 1

    def test_many_disconnects_degrade_provider(self):
        """Repeated disconnects should mark a provider as degraded."""
        tracker = ReputationTracker()
        for _ in range(10):
            tracker.record_disconnect("p1")
        assert tracker.is_degraded("p1")

    def test_disconnect_outcome_in_recent_history(self):
        """Disconnect events appear in the recent outcomes history."""
        tracker = ReputationTracker()
        tracker.record_disconnect("p1")
        rep = tracker.get_or_create("p1")
        assert len(rep.recent_outcomes) == 1
        assert rep.recent_outcomes[0].outcome == RequestOutcome.DISCONNECT
