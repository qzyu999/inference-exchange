"""#134 requested/served attribution, migration and ledger regression tests.

All Store instances use disposable pytest tmp_path databases. No production I/O.
"""
import asyncio
import sqlite3
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.model_attribution import served_model_for_request
from inference_exchange.coordinator.provider_hub import ConnectedProvider, ProviderHub
from inference_exchange.coordinator.routes_inference import (
    _collect_response, _make_billing_callback, _stream_response,
)
from inference_exchange.coordinator.store import MIN_CHARGE_MICRO, SCHEMA, Store
from inference_exchange.shared.protocol import (
    InferenceDone, InferenceError, InferenceRequest, InferenceResponseChunk,
    ProviderCapabilities, TrustLevel,
)


def provider(models, principal="provider-acct-stable"):
    return ConnectedProvider(
        provider_id="route-node",
        name="OCIP test node",
        ws=AsyncMock(),
        capabilities=ProviderCapabilities(
            models=models, trust_level=TrustLevel.OPEN,
            price_per_mtok_input=0.05, price_per_mtok_output=0.15,
        ),
        billing_account_id=principal,
        session_id="conn-test-stable",
    )


@pytest.mark.parametrize("requested,models,confirmed,expected", [
    ("default", ["Qwen"], "Qwen", "Qwen"),
    ("Qwen", ["Qwen"], None, "Qwen"),  # older single-model agent
    ("default", ["Qwen"], None, "Qwen"),
    ("default", ["Qwen", "Llama"], None, None),
    ("Qwen", ["Qwen", "Llama"], None, None),
    ("Qwen", ["Qwen", "Llama"], "Qwen", "Qwen"),
    ("default", ["Qwen", "Llama"], "Llama", "Llama"),
    ("Qwen", ["Qwen", "Llama"], "Llama", None),
    ("default", ["Qwen"], "unadvertised", None),
    ("Qwen", ["Llama"], None, None),
])
def test_resolution_never_guesses_multimodel(requested, models, confirmed, expected):
    done = InferenceDone(request_id="r", served_model=confirmed) if confirmed is not None else None
    assert served_model_for_request(requested, provider(models), done) == expected


def test_optional_wire_identity_keeps_older_ocip_messages_valid():
    old = InferenceDone(request_id="old", tokens_generated=3)
    assert old.served_model is None
    new = InferenceDone(**{**old.model_dump(), "served_model": "Qwen"})
    assert new.served_model == "Qwen"


def test_legacy_sqlite_migration_twice_does_not_rewrite_money_or_models(tmp_path):
    path = tmp_path / "legacy.db"
    legacy = sqlite3.connect(path)
    old_schema = SCHEMA.replace("    requested_model TEXT,\n    served_model TEXT,\n", "")
    assert old_schema != SCHEMA
    legacy.executescript(old_schema)
    legacy.execute(
        """INSERT INTO transactions (
            request_id, consumer_id, provider_id, model, input_tokens,
            output_tokens, cost_micro, provider_earning_micro,
            platform_fee_micro, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("historic", "consumer-a", "provider-acct-legacy", "default",
         9, 2, 100, 90, 10, 42.0),
    )
    legacy.commit()
    legacy.close()

    store = Store(path)
    store._migrate()
    store._migrate()
    rows = store.list_consumer_transactions("consumer-a")
    assert len(rows) == 1
    r = rows[0]
    assert (r["model"], r["requested_model"], r["served_model"]) == ("default", None, None)
    assert (r["provider_id"], r["cost_micro"], r["provider_earning_micro"], r["platform_fee_micro"]) == (
        "provider-acct-legacy", 100, 90, 10
    )
    assert r["cost_micro"] == r["provider_earning_micro"] + r["platform_fee_micro"]
    assert len([c for c in store._conn.execute("PRAGMA table_info(transactions)") if c[1] == "served_model"]) == 1


@pytest.mark.parametrize("requested,models,confirmed,expected", [
    ("default", ["Qwen"], "Qwen", "Qwen"),
    ("Qwen", ["Qwen"], "Qwen", "Qwen"),
    ("default", ["Qwen", "Llama"], None, None),
    ("default", ["Qwen", "Llama"], "Llama", "Llama"),
])
def test_real_sqlite_callback_micro_ledger_and_private_history(
    monkeypatch, tmp_path, requested, models, confirmed, expected,
):
    from inference_exchange.coordinator import routes_inference as ri
    store = Store(tmp_path / "only-test.db")
    store._ensure_account("consumer-a", "A")
    store._ensure_account("consumer-b", "B")
    p = provider(models)
    events = []
    tracker = Mock()
    monkeypatch.setattr(ri, "get_billing", lambda: store)
    monkeypatch.setattr(ri, "get_event_bus", lambda: SimpleNamespace(publish=events.append))
    monkeypatch.setattr(ri, "get_tps_tracker", lambda: tracker)
    monkeypatch.setattr(ri, "_complete_trace", Mock())

    before_consumer = store.get_account("consumer-a")["balance_micro"]
    before_provider = store.get_or_create_account(p.billing_account_id)["balance_micro"]
    cb = _make_billing_callback("req-new", requested, p, "consumer-a", 9, time.time() - 1)
    cb(InferenceDone(
        request_id="req-new", input_tokens=9, tokens_generated=2,
        served_model=confirmed,
    ))
    rows = store.list_consumer_transactions("consumer-a")
    assert len(rows) == 1
    r = rows[0]
    assert (r["model"], r["requested_model"], r["served_model"]) == (requested, requested, expected)
    assert r["provider_id"] == p.billing_account_id
    assert r["connection_id"] == p.session_id
    assert r["cost_micro"] == MIN_CHARGE_MICRO == 100
    assert r["cost_micro"] == r["provider_earning_micro"] + r["platform_fee_micro"]
    assert store.get_account("consumer-a")["balance_micro"] == before_consumer - r["cost_micro"]
    assert store.get_account(p.billing_account_id)["balance_micro"] == before_provider + r["provider_earning_micro"]
    assert store.list_consumer_transactions("consumer-b") == []
    assert events[0]["requested_model"] == requested
    assert events[0]["served_model"] == expected
    assert events[0]["cost_usd"] == MIN_CHARGE_MICRO / 1_000_000
    if expected is None:
        tracker.record_request.assert_not_called()
    else:
        tracker.record_request.assert_called_once()
        assert tracker.record_request.call_args.kwargs["model"] == expected


@pytest.mark.asyncio
async def test_done_idempotence_and_provider_error_never_charges(monkeypatch, tmp_path):
    from inference_exchange.coordinator import routes_inference as ri
    store = Store(tmp_path / "idempotent.db")
    store._ensure_account("consumer-a", "A")
    p = provider(["Qwen"])
    hub = ProviderHub()
    hub._providers[p.provider_id] = p
    monkeypatch.setattr(ri, "get_billing", lambda: store)
    monkeypatch.setattr(ri, "get_event_bus", lambda: None)
    monkeypatch.setattr(ri, "get_tps_tracker", lambda: Mock())
    monkeypatch.setattr(ri, "_complete_trace", Mock())

    hub.create_response_queue("failed")
    hub.register_billing_callback(
        "failed", _make_billing_callback("failed", "default", p, "consumer-a", 9, time.time() - 1),
    )
    hub.handle_provider_message(p.provider_id, InferenceError(request_id="failed", error="unavailable").model_dump())
    hub.create_response_queue("completed")
    hub.register_billing_callback(
        "completed", _make_billing_callback("completed", "default", p, "consumer-a", 9, time.time() - 1),
    )
    done = InferenceDone(request_id="completed", served_model="Qwen", tokens_generated=3)
    hub.handle_provider_message(p.provider_id, done.model_dump())
    hub.handle_provider_message(p.provider_id, done.model_dump())  # duplicated completion
    await asyncio.sleep(0)
    assert [r["request_id"] for r in store.list_consumer_transactions("consumer-a")] == ["completed"]
    assert sum(r["cost_micro"] for r in store.list_consumer_transactions("consumer-a")) == 100


@pytest.mark.asyncio
async def test_queued_provider_assignment_retains_identity():
    hub = ProviderHub()
    p = provider(["Qwen"])
    hub._providers[p.provider_id] = p
    p.active_requests = p.capabilities.max_concurrent
    pending = hub.enqueue_request(InferenceRequest(
        request_id="queued", model="default", messages=[{"role": "user", "content": "hi"}]
    ), model="default", min_confidence="open")
    assert pending.provider is None
    p.active_requests = 0
    await hub._try_dispatch_queued()
    assert pending.provider is p
    assert served_model_for_request(pending.model, pending.provider) == "Qwen"


@pytest.mark.asyncio
async def test_stream_and_nonstream_keep_request_and_report_actual(monkeypatch):
    from inference_exchange.coordinator import routes_inference as ri
    monkeypatch.setattr(ri, "get_reputation_tracker", lambda: SimpleNamespace(record_success=lambda *a, **kw: None))
    p = provider(["Qwen"])
    hub = SimpleNamespace(remove_response_queue=Mock())

    streaming_queue = asyncio.Queue()
    await streaming_queue.put(InferenceResponseChunk(request_id="stream", token="hi"))
    await streaming_queue.put(InferenceDone(request_id="stream", served_model="Qwen", tokens_generated=1))
    frames = [frame async for frame in _stream_response("stream", "default", streaming_queue, hub, p, "a", time.time())]
    import json
    chunks = [json.loads(f.removeprefix("data: ").strip()) for f in frames if f != "data: [DONE]\n\n"]
    assert all(c["model"] == "default" and c["ocip_served_model"] == "Qwen" for c in chunks)
    assert all(c["ocip_requested_model"] == "default" for c in chunks)

    nonstream_queue = asyncio.Queue()
    await nonstream_queue.put(InferenceResponseChunk(request_id="single", token="ok"))
    await nonstream_queue.put(InferenceDone(request_id="single", served_model="Qwen", tokens_generated=1))
    response = await _collect_response("single", "default", nonstream_queue, hub, p, "a", time.time())
    assert response["choices"][0]["message"]["content"] == "ok"
    assert (response["model"], response["ocip_requested_model"], response["ocip_served_model"]) == (
        "default", "default", "Qwen"
    )
