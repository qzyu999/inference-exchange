"""#84: isolated SQLite concurrency and failure-injection regression tests.

No network calls and no production databases. The full Store write-path
audit is tracked in #84; these tests cover the highest-risk charge/collector
interleaving and its earlier implicit helper commit.
"""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from inference_exchange.coordinator.price_collector import PriceCollector, PriceEntry
from inference_exchange.coordinator.store import MICRO_PER_DOLLAR, Store


def test_charge_and_collector_snapshot_are_atomic_under_concurrency(tmp_path):
    store = Store(db_path=tmp_path / "billing-price-race.db")
    store.get_or_create_account("buyer")
    collector = PriceCollector(store=store)
    for idx in range(9):
        entry = PriceEntry(
            source="race-test", model_id=f"model-{idx}", display_name=f"Model {idx}",
            family="test", family_key="test", input_per_mtok=0.3, output_per_mtok=0.7,
        )
        collector._cache[(entry.source, entry.model_id)] = entry

    def charge(i):
        result = store.charge_request(
            f"r-{i}", "buyer", "race-provider", "model-0",
            13, 27, 0.3, 0.7,
        )
        assert result["cost_micro"] == result["provider_earning_micro"] + result["platform_fee_micro"]
        return result

    def snapshot(i):
        collector._persist_snapshot()
        return i

    tasks = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        for i in range(120):
            tasks.append(pool.submit(charge, i))
            if i % 10 == 0:
                tasks.append(pool.submit(snapshot, i))
        results = [f.result() for f in tasks]

    bills = [v for v in results if isinstance(v, dict)]
    txs = store._conn.execute(
        "SELECT cost_micro, provider_earning_micro, platform_fee_micro FROM transactions",
    ).fetchall()
    assert len(bills) == len(txs) == 120
    assert all(tx["cost_micro"] == tx["provider_earning_micro"] + tx["platform_fee_micro"] for tx in txs)
    cost = sum(x["cost_micro"] for x in txs)
    earnings = sum(x["provider_earning_micro"] for x in txs)
    fees = sum(x["platform_fee_micro"] for x in txs)
    assert cost == earnings + fees
    assert store.get_account("buyer")["total_spent_micro"] == cost
    assert store.get_account("race-provider")["total_earned_micro"] == earnings
    # Failed/silently swallowed snapshot writes would leave fewer than 12*9 rows.
    assert store._conn.execute("SELECT COUNT(*) FROM reference_prices").fetchone()[0] == 12 * 9
    collector._prune_old()
    assert store._conn.execute("SELECT COUNT(*) FROM reference_prices").fetchone()[0] == 12 * 9


def test_failed_transaction_rolls_back_debit_new_principal_and_credit(tmp_path):
    store = Store(db_path=tmp_path / "failed-charge.db")
    store.get_or_create_account("buyer")
    before = dict(store.get_account("buyer"))
    store._conn.execute(
        """CREATE TRIGGER fail_this_charge BEFORE INSERT ON transactions
           WHEN NEW.request_id = 'fail-tx'
           BEGIN SELECT RAISE(ABORT, 'test transaction failure'); END"""
    )
    store._conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        store.charge_request(
            "fail-tx", "buyer", "provider-that-did-not-exist",
            "test-model", 5, 7, 0.2, 0.4,
        )
    assert store.get_account("buyer") == before
    assert store.get_account("provider-that-did-not-exist") is None
    assert store._conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
    # The same connection remains usable after rollback.
    result = store.charge_request(
        "good-tx", "buyer", "new-provider", "test-model",
        5, 7, 0.2, 0.4,
    )
    assert result["cost_micro"] == result["provider_earning_micro"] + result["platform_fee_micro"]
    assert store.get_account("new-provider")["balance_micro"] == 10 * MICRO_PER_DOLLAR + result["provider_earning_micro"]
