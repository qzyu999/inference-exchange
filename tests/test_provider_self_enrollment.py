"""PROV-018: owner-scoped enrollment uses disposable SQLite databases only."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.routes_auth import _session_token
from inference_exchange.coordinator.store import ProviderOwnershipError, Store
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage


PROFILE = "apple-silicon-macos-gguf-metal-l0"


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "self-enroll.db"))
    monkeypatch.setenv("IE_JWT_SECRET", "self-enroll-test-secret")
    monkeypatch.setenv("IE_PRICE_COLLECTOR", "0")
    monkeypatch.setenv("IE_PUBLIC_URL", "https://testserver")
    monkeypatch.setenv("IE_PROVIDER_SELF_ENROLL_ENABLED", "1")
    root = TestClient(create_app(), base_url="https://testserver")
    store = dependencies.get_store()
    alice, _ = store.upsert_github_user("92001", "alice", "alice@example.com", "Alice")
    bob, _ = store.upsert_github_user("92002", "bob", "bob@example.com", "Bob")
    legacy, _ = store.upsert_github_user("92003", "old", "old@example.com", "Old")
    return root, store, alice, bob, legacy


def headers(user):
    return {"Authorization": "Bearer " + _session_token(user)}


def enroll(root, user, name="test-mini", profile=PROFILE):
    return root.post("/v1/provider/nodes", json={"name": name, "profile": profile},
                     headers=headers(user))


def registration():
    return RegisterMessage(
        provider_name="claimed-m6",
        capabilities=ProviderCapabilities(models=["mock"], hardware="apple-m6", model_format="gguf"),
    ).model_dump()


def test_non_admin_enrollment_and_exact_earnings(setup):
    root, store, alice, bob, _ = setup
    response = enroll(root, alice)
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    node = body["node"]["node_id"]
    secret = body["credential"]["token"]
    assert secret.startswith("pt-ie-") and body["simulated_credits"] is True
    token = store.validate_provider_token(secret)
    assert token["node_id"] == node and token["issuance_source"] == "self_service"
    principal = token["billing_account_id"]
    assert store.get_provider_node_owner(node, principal) == alice["user_id"]
    assert store.get_account(principal)["total_earned_micro"] == 0
    assert store.get_account(principal)["balance_micro"] == 10_000_000
    assert store.list_owned_provider_nodes(bob["user_id"]) == []
    assert secret not in str(root.get("/v1/provider/nodes", headers=headers(alice)).json())
    with root.websocket_connect("/ws/provider", headers={"Authorization": "Bearer " + secret}) as ws:
        ws.send_json(registration())
        provider_id = ws.receive_json()["provider_id"]
        assert dependencies.get_hub()._providers[provider_id].billing_account_id == principal
    store.get_or_create_account("test-buyer")
    billed = store.charge_request("r-self", "test-buyer", principal, "mock", 10, 20, 0.1, 0.1)
    assert (billed["cost_micro"], billed["provider_earning_micro"], billed["platform_fee_micro"]) == (100, 90, 10)
    earnings = root.get("/v1/provider/earnings", headers=headers(alice)).json()
    assert earnings["summary"]["earned_micro"] == 90
    assert earnings["summary"]["reconciled"] is True
    assert root.get("/v1/provider/earnings", headers=headers(bob)).json()["summary"]["earned_micro"] == 0
    assert root.get("/v1/provider/earnings?node_id=" + node, headers=headers(bob)).status_code == 404


def test_enrollment_guards_and_cap(setup, monkeypatch):
    root, store, alice, bob, _ = setup
    url = "/v1/provider/nodes"
    payload = {"name": "mini", "profile": PROFILE}
    assert root.post(url, json=payload).status_code == 401
    consumer_key = store.create_api_key_for_user(alice["user_id"])
    assert root.post(url, json=payload, headers={"Authorization": "Bearer " + consumer_key}).status_code == 401
    assert root.post(url, json=payload, headers={"Authorization": "Bearer pt-ie-bad"}).status_code == 401
    assert root.post(url, json={**payload, "owner_user_id": bob["user_id"]},
                     headers=headers(alice)).status_code == 400
    assert enroll(root, alice, name="bad\\nname").status_code == 400
    assert enroll(root, alice, profile="apple-cuda-l2").status_code == 400
    assert len(store.list_owned_provider_nodes(alice["user_id"])) == 0
    assert enroll(root, alice).status_code == 201
    assert enroll(root, alice).status_code == 409
    other = enroll(root, bob)
    assert other.status_code == 201
    assert other.json()["node"]["node_id"] != store.list_owned_provider_nodes(alice["user_id"])[0]["node_id"]
    cookie = {"ie_session": _session_token(alice)}
    assert root.post(url, json=payload, cookies=cookie).status_code == 403
    # Explicit wrong-origin request is denied before body handling.
    assert root.post(url, json=payload, cookies=cookie, headers={"Origin": "https://evil.example"}).status_code == 403
    password_only = store.create_user("password@example.com", "not-a-production-login")
    password_only["session_version"] = store.get_session_version(password_only["user_id"])
    assert root.post(url, json=payload, headers=headers(password_only)).status_code == 403
    store.suspend_user(bob["user_id"], "abuse", alice["user_id"], None)
    # Suspension revokes prior sessions (401). A newly issued signed session
    # with the current version receives the distinct suspended-account 403.
    assert enroll(root, bob).status_code == 401
    bob["session_version"] = store.get_session_version(bob["user_id"])
    assert enroll(root, bob).status_code == 403
    monkeypatch.setenv("IE_PROVIDER_SELF_ENROLL_ENABLED", "0")
    assert root.post(url, json=payload, headers=headers(alice)).status_code == 503


def test_competing_enrollments_are_atomic(setup):
    _, store, alice, _, _ = setup
    def attempt():
        try:
            return store.enroll_provider_node(alice["user_id"], "mini", PROFILE)
        except ProviderOwnershipError as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert len([r for r in results if isinstance(r, dict)]) == 1
    assert [r for r in results if isinstance(r, int)] == [409]
    assert store._conn.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0] == 1
    assert store._conn.execute(
        "SELECT COUNT(*) FROM provider_tokens WHERE issuance_source = 'self_service'"
    ).fetchone()[0] == 1


def test_legacy_provider_remains_unchanged(setup):
    root, store, alice, _, legacy = setup
    existing = store.create_provider_token("m6-mac-mini")
    existing_principal = store.validate_provider_token(existing)["billing_account_id"]
    store.claim_legacy_provider(existing_principal, legacy["user_id"], alice["user_id"], "test claim")
    store.get_or_create_account("buyer")
    store.charge_request("r-old", "buyer", existing_principal, "mock", 10, 30, 0.1, 0.1)
    sql = "SELECT token_hash, token_id, billing_account_id, node_id, revoked_at FROM provider_tokens WHERE billing_account_id = ?"
    before = dict(store._conn.execute(sql, (existing_principal,)).fetchone())
    before_account = store.get_account(existing_principal)
    before_transactions = [dict(x) for x in store._conn.execute("SELECT * FROM transactions")]
    assert enroll(root, alice).status_code == 201
    assert dict(store._conn.execute(sql, (existing_principal,)).fetchone()) == before
    assert store.get_account(existing_principal) == before_account
    assert [dict(x) for x in store._conn.execute("SELECT * FROM transactions")] == before_transactions


def test_rollback_on_failed_write(setup):
    _, store, alice, _, _ = setup
    # Abort at the audit statement after earlier inserts; BEGIN IMMEDIATE must roll back.
    with sqlite3.connect(store._db_path) as conn:
        conn.execute("""CREATE TRIGGER fail_enroll_audit BEFORE INSERT ON provider_ownership_actions
                     WHEN NEW.action = 'enroll' BEGIN SELECT RAISE(ABORT, 'test rollback'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        store.enroll_provider_node(alice["user_id"], "mini", PROFILE)
    assert store._conn.execute("SELECT COUNT(*) FROM provider_nodes").fetchone()[0] == 0
    assert store._conn.execute(
        "SELECT COUNT(*) FROM provider_tokens WHERE issuance_source = 'self_service'"
    ).fetchone()[0] == 0
    assert store._conn.execute("SELECT COUNT(*) FROM accounts WHERE account_id LIKE 'provider-acct-%'").fetchone()[0] == 0
