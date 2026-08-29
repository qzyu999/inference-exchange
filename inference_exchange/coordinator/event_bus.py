"""Pub/sub event bus for real-time dashboard updates via WebSocket."""

import asyncio
import logging
import time
from collections import deque

logger = logging.getLogger(__name__)

# Valid event types pushed through the bus
EVENT_TYPES = frozenset({
    "match",
    "billing",
    "provider_connect",
    "provider_disconnect",
    "attestation",
    "error",
    "reputation_change",
})

# Maximum number of recent events kept for catch-up
MAX_HISTORY = 50


class EventBus:
    """Simple async pub/sub: subscribers receive events via asyncio.Queue."""

    def __init__(self):
        self._subscribers: set[asyncio.Queue] = set()
        self._history: deque[dict] = deque(maxlen=MAX_HISTORY)

    # ------------------------------------------------------------------
    # Subscriber management
    # ------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        """Create and return a new subscriber queue."""
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        logger.debug(f"EventBus: subscriber added (total={len(self._subscribers)})")
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        self._subscribers.discard(queue)
        logger.debug(f"EventBus: subscriber removed (total={len(self._subscribers)})")

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------

    def publish(self, event: dict) -> None:
        """Send *event* to every subscriber and append to history.

        Events should contain at least a ``"type"`` key.  A ``"timestamp"``
        is added automatically if not already present.
        """
        if "timestamp" not in event:
            event["timestamp"] = time.time()

        self._history.append(event)

        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("EventBus: dropping event for a slow subscriber")

    # ------------------------------------------------------------------
    # History (for catch-up endpoint)
    # ------------------------------------------------------------------

    def recent_events(self, n: int = MAX_HISTORY) -> list[dict]:
        """Return the last *n* events (most recent last)."""
        items = list(self._history)
        return items[-n:]
