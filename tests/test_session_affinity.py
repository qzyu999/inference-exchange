"""Tests for session affinity routing in the ProviderHub."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from inference_exchange.coordinator.provider_hub import ConnectedProvider, ProviderHub
from inference_exchange.shared.protocol import ProviderCapabilities, TrustLevel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_capabilities(
    models: list[str] | None = None,
    price_in: float = 1.0,
    price_out: float = 2.0,
    trust: str = "open",
    max_concurrent: int = 4,
    tps: float = 50.0,
) -> ProviderCapabilities:
    return ProviderCapabilities(
        models=models or ["llama-3.2-1b"],
        max_concurrent=max_concurrent,
        trust_level=TrustLevel(trust),
        price_per_mtok_input=price_in,
        price_per_mtok_output=price_out,
        measured_tps=tps,
        hardware="test",
        memory_gb=16,
    )


def _add_provider(
    hub: ProviderHub,
    name: str,
    caps: ProviderCapabilities | None = None,
    encryption_key: str = "",
) -> str:
    """Manually insert a provider into the hub (bypassing WebSocket registration)."""
    hub._next_provider_id += 1
    pid = f"provider-{hub._next_provider_id}"
    hub._providers[pid] = ConnectedProvider(
        provider_id=pid,
        name=name,
        ws=MagicMock(),  # We won't send over the socket in these tests
        capabilities=caps or _make_capabilities(),
        encryption_public_key=encryption_key,
    )
    return pid


# ---------------------------------------------------------------------------
# Same session_id routes to same provider
# ---------------------------------------------------------------------------

class TestSessionAffinity:
    def test_same_session_gets_same_provider(self):
        hub = ProviderHub()
        pid1 = _add_provider(hub, "P1")
        pid2 = _add_provider(hub, "P2")

        # First request with session_id
        chosen = hub.select_provider("llama-3.2-1b", session_id="sess-abc")
        assert chosen is not None
        first_pid = chosen.provider_id

        # Second request with the same session_id → same provider
        chosen2 = hub.select_provider("llama-3.2-1b", session_id="sess-abc")
        assert chosen2 is not None
        assert chosen2.provider_id == first_pid

    def test_affinity_persists_across_many_calls(self):
        hub = ProviderHub()
        _add_provider(hub, "P1")
        _add_provider(hub, "P2")
        _add_provider(hub, "P3")

        first = hub.select_provider("llama-3.2-1b", session_id="sticky")
        for _ in range(10):
            chosen = hub.select_provider("llama-3.2-1b", session_id="sticky")
            assert chosen.provider_id == first.provider_id


# ---------------------------------------------------------------------------
# New session_id gets normal routing (no affinity)
# ---------------------------------------------------------------------------

class TestNewSessionRouting:
    def test_new_session_routes_normally(self):
        hub = ProviderHub()
        _add_provider(hub, "P1")
        chosen = hub.select_provider("llama-3.2-1b", session_id="brand-new")
        assert chosen is not None

    def test_no_session_routes_normally(self):
        hub = ProviderHub()
        _add_provider(hub, "P1")
        chosen = hub.select_provider("llama-3.2-1b")
        assert chosen is not None

    def test_different_sessions_can_get_different_providers(self):
        """Two different sessions can each be routed independently."""
        hub = ProviderHub()
        _add_provider(hub, "P1")
        _add_provider(hub, "P2")

        s1 = hub.select_provider("llama-3.2-1b", session_id="sess-1")
        s2 = hub.select_provider("llama-3.2-1b", session_id="sess-2")
        assert s1 is not None
        assert s2 is not None
        # They may or may not differ — the point is both got routed


# ---------------------------------------------------------------------------
# If affinity provider is disconnected, falls back to normal routing
# ---------------------------------------------------------------------------

class TestAffinityFallback:
    def test_fallback_when_affinity_provider_disconnects(self):
        hub = ProviderHub()
        pid1 = _add_provider(hub, "P1")
        pid2 = _add_provider(hub, "P2")

        # Establish affinity with P1
        chosen = hub.select_provider("llama-3.2-1b", session_id="sess-x")
        affinity_pid = chosen.provider_id

        # Disconnect the affinity provider
        hub.disconnect_provider(affinity_pid)

        # Should fall back to the remaining provider
        fallback = hub.select_provider("llama-3.2-1b", session_id="sess-x")
        assert fallback is not None
        assert fallback.provider_id != affinity_pid

    def test_fallback_when_affinity_provider_at_capacity(self):
        hub = ProviderHub()
        pid1 = _add_provider(hub, "P1", _make_capabilities(max_concurrent=1))
        pid2 = _add_provider(hub, "P2", _make_capabilities(max_concurrent=4))

        # Establish affinity with P1
        hub._session_affinity["sess-cap"] = pid1
        # Max out P1
        hub._providers[pid1].active_requests = 1

        # Should fall back because P1 is at capacity (score_for_request → -1)
        chosen = hub.select_provider("llama-3.2-1b", session_id="sess-cap")
        assert chosen is not None
        assert chosen.provider_id == pid2


# ---------------------------------------------------------------------------
# Affinity respects hard constraints (min_confidence, max_price)
# ---------------------------------------------------------------------------

class TestAffinityConstraints:
    def test_affinity_skipped_if_confidence_too_low(self):
        hub = ProviderHub()
        pid_open = _add_provider(hub, "OpenProvider", _make_capabilities(trust="open"))
        pid_hard = _add_provider(hub, "HardenedProvider", _make_capabilities(trust="hardened"))

        # Establish affinity with the open provider
        hub._session_affinity["sess-conf"] = pid_open

        # Request requires hardened — open provider should be skipped
        chosen = hub.select_provider(
            "llama-3.2-1b",
            session_id="sess-conf",
            min_confidence="hardened",
        )
        assert chosen is not None
        assert chosen.provider_id == pid_hard

    def test_affinity_skipped_if_price_too_high(self):
        hub = ProviderHub()
        pid_expensive = _add_provider(
            hub, "Expensive", _make_capabilities(price_out=10.0)
        )
        pid_cheap = _add_provider(
            hub, "Cheap", _make_capabilities(price_out=0.5)
        )

        # Establish affinity with the expensive provider
        hub._session_affinity["sess-price"] = pid_expensive

        # Request has max_price=1.0 — expensive provider should be skipped
        chosen = hub.select_provider(
            "llama-3.2-1b",
            session_id="sess-price",
            max_price=1.0,
        )
        assert chosen is not None
        assert chosen.provider_id == pid_cheap

    def test_affinity_honored_when_constraints_met(self):
        hub = ProviderHub()
        pid1 = _add_provider(hub, "P1", _make_capabilities(trust="hardened", price_out=0.5))
        pid2 = _add_provider(hub, "P2", _make_capabilities(trust="hardened", price_out=0.5))

        # Establish affinity with P1
        hub._session_affinity["sess-ok"] = pid1

        # Request constraints are met by P1 → affinity honored
        chosen = hub.select_provider(
            "llama-3.2-1b",
            session_id="sess-ok",
            min_confidence="hardened",
            max_price=1.0,
        )
        assert chosen is not None
        assert chosen.provider_id == pid1
