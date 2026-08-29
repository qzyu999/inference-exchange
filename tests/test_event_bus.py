"""Tests for the EventBus pub/sub system and recent-events catch-up."""

import asyncio

import pytest

from inference_exchange.coordinator.event_bus import EventBus, MAX_HISTORY


# ---------------------------------------------------------------------------
# subscribe / publish / unsubscribe
# ---------------------------------------------------------------------------


class TestPubSub:
    """Core subscribe → publish → receive cycle."""

    def test_subscribe_returns_queue(self):
        bus = EventBus()
        q = bus.subscribe()
        assert isinstance(q, asyncio.Queue)
        assert bus.subscriber_count == 1

    def test_publish_delivers_to_subscriber(self):
        bus = EventBus()
        q = bus.subscribe()
        bus.publish({"type": "match", "provider": "alice"})
        assert not q.empty()
        event = q.get_nowait()
        assert event["type"] == "match"
        assert event["provider"] == "alice"
        assert "timestamp" in event

    def test_publish_adds_timestamp_if_missing(self):
        bus = EventBus()
        q = bus.subscribe()
        bus.publish({"type": "billing"})
        event = q.get_nowait()
        assert isinstance(event["timestamp"], float)

    def test_publish_preserves_existing_timestamp(self):
        bus = EventBus()
        q = bus.subscribe()
        bus.publish({"type": "billing", "timestamp": 42.0})
        event = q.get_nowait()
        assert event["timestamp"] == 42.0

    def test_unsubscribe_removes_queue(self):
        bus = EventBus()
        q = bus.subscribe()
        assert bus.subscriber_count == 1
        bus.unsubscribe(q)
        assert bus.subscriber_count == 0

    def test_unsubscribed_queue_stops_receiving(self):
        bus = EventBus()
        q = bus.subscribe()
        bus.unsubscribe(q)
        bus.publish({"type": "error", "detail": "something"})
        assert q.empty()

    def test_unsubscribe_unknown_queue_is_noop(self):
        bus = EventBus()
        foreign_q: asyncio.Queue = asyncio.Queue()
        bus.unsubscribe(foreign_q)  # should not raise
        assert bus.subscriber_count == 0


# ---------------------------------------------------------------------------
# Multiple subscribers
# ---------------------------------------------------------------------------


class TestMultipleSubscribers:
    """All subscribers receive every published event."""

    def test_two_subscribers_receive_same_event(self):
        bus = EventBus()
        q1 = bus.subscribe()
        q2 = bus.subscribe()
        bus.publish({"type": "provider_connect", "provider": "bob"})

        e1 = q1.get_nowait()
        e2 = q2.get_nowait()
        assert e1 == e2
        assert e1["type"] == "provider_connect"

    def test_unsubscribing_one_does_not_affect_other(self):
        bus = EventBus()
        q1 = bus.subscribe()
        q2 = bus.subscribe()
        bus.unsubscribe(q1)
        bus.publish({"type": "attestation", "status": "passed"})

        assert q1.empty()
        assert not q2.empty()
        assert q2.get_nowait()["type"] == "attestation"


# ---------------------------------------------------------------------------
# Event history (for catch-up endpoint)
# ---------------------------------------------------------------------------


class TestEventHistory:
    """recent_events() returns the last N events for late-joining clients."""

    def test_recent_events_empty_initially(self):
        bus = EventBus()
        assert bus.recent_events() == []

    def test_recent_events_returns_published_events(self):
        bus = EventBus()
        bus.publish({"type": "match", "provider": "a"})
        bus.publish({"type": "billing", "cost_usd": 0.001})

        events = bus.recent_events()
        assert len(events) == 2
        assert events[0]["type"] == "match"
        assert events[1]["type"] == "billing"

    def test_recent_events_capped_at_max_history(self):
        bus = EventBus()
        for i in range(MAX_HISTORY + 20):
            bus.publish({"type": "billing", "seq": i})

        events = bus.recent_events()
        assert len(events) == MAX_HISTORY
        # Oldest retained should be seq=20 (first 20 were evicted)
        assert events[0]["seq"] == 20
        assert events[-1]["seq"] == MAX_HISTORY + 19

    def test_recent_events_respects_n_parameter(self):
        bus = EventBus()
        for i in range(10):
            bus.publish({"type": "match", "seq": i})

        events = bus.recent_events(3)
        assert len(events) == 3
        assert events[0]["seq"] == 7

    def test_history_independent_of_subscribers(self):
        """History is recorded even when no one is subscribed."""
        bus = EventBus()
        bus.publish({"type": "provider_disconnect", "provider": "gone"})
        assert len(bus.recent_events()) == 1
