"""#147: bounded L0 provider registration at the WebSocket boundary.

All coordinator tests use a temporary SQLite database, never the live alpha DB.
"""
import asyncio
import copy
import importlib
import json
import threading

import httpx
import pytest
import uvicorn
import websockets
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.provider_registration import (
    MAX_INCOMPLETE_REGISTRATIONS,
    MAX_WS_FRAME_BYTES,
    RegistrationGuard,
)
from inference_exchange.coordinator.store import Store
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage
from test_mock_provider_e2e import _free_port, _wait


def registration():
    """Match the fields sent by the real OCIP Mac mini agent."""
    return RegisterMessage(
        provider_name="m6-mac-mini",
        capabilities=ProviderCapabilities(
            models=["Qwen2.5 0.5B Instruct"],
            hardware="apple-m6",
            model_format="gguf",
            max_concurrent=2,
            measured_tps=0,
            price_per_mtok_input=0.05,
            price_per_mtok_output=0.15,
            price_per_mtok_cache=0,
            context_length=32768,
        ),
        model_identity={
            "name": "Qwen2.5 0.5B Instruct",
            "architecture": "qwen2",
            "quantization": "Q4_K_M",
            "file_hash": "skipped-2200000000",
            "file_size_bytes": 2200000000,
            "filename": "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
            "context_length": 32768,
            "block_count": 24,
            "embedding_length": 896,
            "repo_id": "",
        },
    ).model_dump()


@pytest.fixture()
def alpha(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "test-admission-only")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "registration.db"))
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    client = TestClient(create_app(), base_url="https://testserver")
    store = Store()
    token = store.create_provider_token("alpha-m6")
    return client, store, token


def ws_for(client, token):
    return client.websocket_connect(
        "/ws/provider", headers={"Authorization": f"Bearer {token}"},
    )


def reject(client, token, payload, expected=4002):
    with pytest.raises(WebSocketDisconnect) as err:
        with ws_for(client, token) as ws:
            if isinstance(payload, str):
                ws.send_text(payload)
            else:
                ws.send_text(json.dumps(payload))
            ws.receive_json()
    assert err.value.code == expected


def test_valid_m6_l0_registration_and_matching(alpha):
    client, store, token = alpha
    expected = store.validate_provider_token(token)["billing_account_id"]
    with ws_for(client, token) as ws:
        ws.send_json(registration())
        result = ws.receive_json()
        assert result["type"] == "registered"
        assert result["confidence_level"] == "open"
        p = dependencies.get_hub()._providers[result["provider_id"]]
        assert p.billing_account_id == expected
        assert p.capabilities.max_concurrent == 2
        assert dependencies.get_hub().select_provider(
            "Qwen2.5 0.5B Instruct", min_confidence="open",
        ) is p


@pytest.mark.parametrize("bad", [-1, -0.99, float("nan"), float("inf"), -float("inf"), 100.01, 1e300, "0.1", True])
@pytest.mark.parametrize("field", ["price_per_mtok_input", "price_per_mtok_output", "price_per_mtok_cache"])
def test_invalid_prices_rejected(alpha, bad, field):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"][field] = bad
    reject(client, token, msg)


@pytest.mark.parametrize("value", [0, -1, 17, 1_000_000, "2", True, 1.5])
def test_invalid_slots_rejected(alpha, value):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"]["max_concurrent"] = value
    reject(client, token, msg)


@pytest.mark.parametrize("field,value", [
    ("measured_tps", -10),
    ("measured_tps", -10.0),
    ("measured_tps", float("nan")),
    ("measured_tps", float("inf")),
    ("measured_tps", 10001),
    ("memory_gb", -1),
    ("memory_gb", float("inf")),
    ("context_length", -1),
    ("context_length", 2**21),
])
def test_invalid_capacity_hints_rejected(alpha, field, value):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"][field] = value
    reject(client, token, msg)


@pytest.mark.parametrize("models", [[], [""], ["   "], ["m" * 129], ["m"] * 9, ["repeat", "repeat"], [1], [{}]])
def test_invalid_model_lists_rejected(alpha, models):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"]["models"] = models
    reject(client, token, msg)


@pytest.mark.parametrize("field,value", [
    ("provider_name", ""),
    ("provider_name", "bad\nname"),
    ("provider_name", "<img src=x>"),
    ("provider_name", "n" * 65),
    ("model_identity", {"deep": {"nested": "value"}}),
    ("model_identity", {"too-big": "x" * 513}),
    ("model_identity", {str(i): i for i in range(33)}),
    ("encryption_public_key", "X" * 1025),
    ("billing_account_id", "provider-acct-victim"),
])
def test_invalid_registration_fields_rejected(alpha, field, value):
    client, _, token = alpha
    msg = registration()
    msg[field] = value
    reject(client, token, msg)


@pytest.mark.parametrize("trust", ["contained", "hardened", "confidential", "Hardened", "unknown", ""])
def test_unverified_trust_rejected(alpha, trust):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"]["trust_level"] = trust
    reject(client, token, msg)


@pytest.mark.parametrize("hardware,fmt", [
    ("nvidia-dgx-spark", "gguf"), ("linux-arm64", "gguf"),
    ("unknown", "gguf"), ("apple-m6", "safetensors"), ("apple-m6", ""),
])
def test_unsupported_alpha_profile_rejected(alpha, hardware, fmt):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"]["hardware"] = hardware
    msg["capabilities"]["model_format"] = fmt
    reject(client, token, msg)


@pytest.mark.parametrize("field,value", [
    ("price_units", "cents"), ("billing_account_id", "provider-acct-victim"),
])
def test_unknown_capability_fields_rejected(alpha, field, value):
    client, _, token = alpha
    msg = registration()
    msg["capabilities"][field] = value
    reject(client, token, msg)


@pytest.mark.parametrize("raw", [
    "not JSON", "[]", "null", "NaN", "{",
    '{"type":"register","type":"register"}',
])
def test_malformed_json_rejected(alpha, raw):
    client, _, token = alpha
    reject(client, token, raw)


def test_oversize_initial_registration_rejected(alpha):
    client, _, token = alpha
    msg = registration()
    msg["model_identity"]["filename"] = "x" * 70_000
    reject(client, token, msg)


def test_wrong_message_type_and_protocol_rejected(alpha):
    client, _, token = alpha
    msg = registration()
    msg["type"] = "heartbeat"
    reject(client, token, msg)
    msg["type"] = "register"
    msg["protocol_version"] = "999"
    reject(client, token, msg)


def test_rejected_registration_cannot_affect_other_provider_or_billing(alpha):
    client, store, token = alpha
    attacker_token = store.create_provider_token("other-credential")
    initial_transactions = store.billing_summary()["total_requests"]
    with ws_for(client, token) as ws:
        ws.send_json(registration())
        pid = ws.receive_json()["provider_id"]
        hub = dependencies.get_hub()
        good = hub._providers[pid]
        principal = good.billing_account_id
        malicious = copy.deepcopy(registration())
        malicious["capabilities"]["price_per_mtok_output"] = -1
        malicious["billing_account_id"] = principal
        reject(client, attacker_token, malicious)
        assert hub.provider_count == 1
        assert hub._providers[pid] is good
        assert good.billing_account_id == principal
        assert hub.select_provider("default", min_confidence="open") is good
        assert hub._pending_queue.qsize() == 0
        assert store.billing_summary()["total_requests"] == initial_transactions


def test_unknown_and_revoked_credentials_fail_before_read(alpha):
    client, store, token = alpha
    with pytest.raises(WebSocketDisconnect) as err:
        with ws_for(client, "pt-ie-not-valid") as ws:
            ws.receive_json()
    assert err.value.code == 4003
    token_id = next(t["token_id"] for t in store.list_provider_tokens() if t["name"] == "alpha-m6")
    assert store.revoke_provider_token(token_id)
    with pytest.raises(WebSocketDisconnect) as err:
        with ws_for(client, token) as ws:
            ws.receive_json()
    assert err.value.code == 4003


def test_missing_first_message_times_out(alpha, monkeypatch):
    main_mod = importlib.import_module("inference_exchange.coordinator.main")
    monkeypatch.setattr(main_mod, "REGISTER_TIMEOUT_SECONDS", 0.03)
    client, _, token = alpha
    with pytest.raises(WebSocketDisconnect) as err:
        with ws_for(client, token) as ws:
            ws.receive_json()
    assert err.value.code == 4008


def test_disconnect_before_first_message_releases_pending_slot(alpha):
    client, _, token = alpha
    with ws_for(client, token):
        pass
    with ws_for(client, token) as ws:
        ws.send_json(registration())
        assert ws.receive_json()["type"] == "registered"


def test_registration_guard_bounded_attempts_and_pending():
    guard = RegistrationGuard()
    for _ in range(MAX_INCOMPLETE_REGISTRATIONS):
        assert guard.begin()
    assert not guard.begin()
    for _ in range(MAX_INCOMPLETE_REGISTRATIONS):
        guard.finish()
    assert guard.pending == 0
    for _ in range(20):
        assert guard.allow("credential-one")
    assert not guard.allow("credential-one")
    assert guard.allow("credential-two")


def test_main_enables_transport_ws_frame_cap(monkeypatch):
    main_mod = importlib.import_module("inference_exchange.coordinator.main")
    opts = {}
    monkeypatch.setattr(main_mod, "create_app", lambda: object())
    monkeypatch.setattr(main_mod.uvicorn, "run", lambda _app, **kw: opts.update(kw))
    main_mod.main()
    assert opts["ws_max_size"] == MAX_WS_FRAME_BYTES


def test_real_uvicorn_rejects_frame_before_registration(alpha):
    """Test the actual WebSocket engine, not only TestClient's app-level parser."""
    client, _, token = alpha
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(
        create_app(), host="127.0.0.1", port=port,
        ws_max_size=MAX_WS_FRAME_BYTES, log_level="warning",
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        assert _wait(lambda: httpx.get(f"http://127.0.0.1:{port}/health").status_code == 200)
        async def oversized():
            async with websockets.connect(
                f"ws://127.0.0.1:{port}/ws/provider",
                extra_headers={"Authorization": f"Bearer {token}"},
            ) as ws:
                with pytest.raises(websockets.exceptions.ConnectionClosed) as err:
                    await ws.send("z" * (MAX_WS_FRAME_BYTES + 100))
                    await ws.recv()
                assert err.value.code == 1009
        asyncio.run(oversized())
    finally:
        server.should_exit = True
        thread.join(timeout=5)
