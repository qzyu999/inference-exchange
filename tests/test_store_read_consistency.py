"""#84: consistent read-only views while shared SQLite writes run concurrently."""

from concurrent.futures import ThreadPoolExecutor

from inference_exchange.coordinator.price_collector import PriceCollector, PriceEntry
from inference_exchange.coordinator.store import Store


def test_concurrent_owner_readers_never_observe_partial_charge(tmp_path):
    store = Store(db_path=tmp_path / "concurrent-read.db")
    owner, _ = store.upsert_github_user("reader-id", "reader", "reader@local.invalid", "Reader")
    signup = store.enroll_provider_node(owner["user_id"], "reader-mac", store.SELF_SERVICE_PROFILE)
    provider = store.validate_provider_token(signup["credential"]["token"])
    principal = provider["billing_account_id"]
    store.get_or_create_account("buyer")

    def charge(i):
        store.charge_request(f"read-charge-{i}", "buyer", principal, "fake-model", 10, 20, 0.1, 0.2)

    def read(i):
        report = store.get_owned_provider_earnings(owner["user_id"])
        assert report["summary"]["reconciled"] is True
        assert report["summary"]["earned_micro"] == report["summary"]["ledger_earned_micro"]
        assert report["summary"]["cost_micro"] == (
            report["summary"]["earned_micro"] + report["summary"]["platform_fee_micro"]
        )
        assert len(report["by_node"]) == 1
        assert report["by_node"][0]["reconciled"] is True
        assert store.list_owned_self_service_credentials(owner["user_id"])[0]["token_id"]
        return report["summary"]["requests_served"]

    tasks = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        for i in range(150):
            tasks.append(pool.submit(charge, i))
            tasks.append(pool.submit(read, i))
        for future in tasks:
            future.result()
    final = store.get_owned_provider_earnings(owner["user_id"])
    assert final["summary"]["requests_served"] == 150
    assert final["summary"]["reconciled"] is True
    assert final["summary"]["earned_micro"] == store.get_account(principal)["total_earned_micro"]


def test_read_paths_do_not_commit_an_outstanding_writer(tmp_path):
    """Reading must not commit the outer write's transaction or bypass its lock."""
    import sqlite3
    import threading
    from concurrent.futures import Future

    store = Store(db_path=tmp_path / "reader-no-commit.db")
    store.get_or_create_account("buyer")
    entered = threading.Event()
    release = threading.Event()

    def writer():
        with store._lock, store._conn:
            store._conn.execute("UPDATE accounts SET balance_micro = 777 WHERE account_id = 'buyer'")
            entered.set()
            assert release.wait(timeout=15)

    def reader():
        entered.wait(timeout=15)
        return store.get_account("buyer")["balance_micro"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(writer)
        assert entered.wait(timeout=15)
        b = pool.submit(reader)
        assert not b.done(), "read-only method must wait for active write"
        release.set()
        a.result(timeout=15)
        assert b.result(timeout=15) == 777
