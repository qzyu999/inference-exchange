"""Recorded routing decisions for one app (ANALYTICS requirements).

Backed by the Store's bounded `request_outcomes` table.
"""

import logging

logger = logging.getLogger(__name__)

TRACE_OWNER_KEY = "_consumer_id"
MAX_TRACES = 100


class TraceLog:
    def __init__(self, store):
        self._store = store

    def add(self, trace: dict, consumer_id: str | None = None) -> None:
        try:
            self._store.save_request_outcome(trace, consumer_id)
        except Exception:
            logger.warning("Request outcome could not be saved")

    def complete(self, request_id: str, consumer_id: str, served_model: str | None, latency_ms: int,
                 provider_country=None, caller_country=None) -> None:
        """Amend the original match decision, keeping request history unambiguous."""
        self._store.amend_request_outcome(
            request_id, consumer_id=consumer_id, status="completed", served_model=served_model,
            latency_ms=latency_ms, provider_country=provider_country, caller_country=caller_country,
        )

    def recent(self, consumer_id: str | None, limit: int = 30) -> list[dict]:
        """Newest first. consumer_id=None returns all traces (admin view)."""
        return self._store.request_outcomes(consumer_id, limit)
