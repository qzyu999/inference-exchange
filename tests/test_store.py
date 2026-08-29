"""Tests for the SQLite persistence layer (store.py).

Covers: accounts, API keys, billing, persistence across restarts,
and provider history — all against a temp DB (never the real path).
"""

import time

import pytest

from inference_exchange.coordinator.store import MICRO_PER_DOLLAR, Store


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def store(tmp_path):
    """Isolated store backed by a temp SQLite DB."""
    return Store(db_path=tmp_path / "test.db")


@pytest.fixture()
def db_path(tmp_path):
    """Return a reusable DB path for persistence tests."""
    return tmp_path / "persist.db"


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


class TestAccounts:
    """Account creation, idempotency, default balance, and listing."""

    def test_default_consumer_created_on_init(self, store):
        """Store __init__ ensures 'default-consumer' exists."""
        acct = store.get_account("default-consumer")
        assert acct is not None
        assert acct["name"] == "Default (anonymous)"

    def test_default_balance_is_ten_dollars(self, store):
        """New accounts start with $10 = 10_000_000 micro-USD."""
        acct = store.get_or_create_account("new-user", "Test User")
        assert acct["balance_micro"] == 10 * MICRO_PER_DOLLAR

    def test_get_or_create_is_idempotent(self, store):
        """Second call returns the same account, same balance."""
        a1 = store.get_or_create_account("u1", "User")
        a2 = store.get_or_create_account("u1", "User")
        assert a1["account_id"] == a2["account_id"]
        assert a1["balance_micro"] == a2["balance_micro"]

    def test_list_accounts_returns_all(self, store):
        """list_accounts includes both the default and any new accounts."""
        store.get_or_create_account("a1", "Alice")
        store.get_or_create_account("a2", "Bob")
        accounts = store.list_accounts()
        ids = {a["account_id"] for a in accounts}
        assert "default-consumer" in ids
        assert "a1" in ids
        assert "a2" in ids

    def test_get_nonexistent_account_returns_none(self, store):
        assert store.get_account("does-not-exist") is None

    def test_balance_change_persisted(self, store):
        """Charging a request mutates balance and the change is readable."""
        raw_key, consumer_id = store.create_api_key("Spender")
        before = store.get_account(consumer_id)["balance_micro"]

        store.charge_request(
            request_id="r1",
            consumer_id=consumer_id,
            provider_id="p1",
            model="m",
            input_tokens=100_000,
            output_tokens=50_000,
            price_per_mtok_input=1.0,
            price_per_mtok_output=2.0,
        )

        after = store.get_account(consumer_id)["balance_micro"]
        assert after < before


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------


class TestAPIKeys:
    """Key creation, validation, and resolution."""

    def test_create_returns_raw_key_and_consumer_id(self, store):
        raw_key, consumer_id = store.create_api_key("My Key")
        assert raw_key.startswith("sk-ie-")
        assert consumer_id.startswith("consumer-")

    def test_validate_valid_key(self, store):
        raw_key, consumer_id = store.create_api_key("K1")
        meta = store.validate_key(raw_key)
        assert meta is not None
        assert meta["consumer_id"] == consumer_id

    def test_validate_invalid_key_returns_none(self, store):
        assert store.validate_key("sk-ie-bogus0000000000000000000000000000") is None

    def test_validate_empty_key_returns_none(self, store):
        assert store.validate_key("") is None

    def test_validate_wrong_prefix_returns_none(self, store):
        assert store.validate_key("wrong-prefix-abc123") is None

    def test_validate_increments_requests_made(self, store):
        raw_key, _ = store.create_api_key("Counter")
        # validate_key SELECTs first, then UPDATEs — the returned row
        # reflects the count *before* the current call's increment.
        m1 = store.validate_key(raw_key)
        assert m1["requests_made"] == 0  # was 0, now bumped to 1
        m2 = store.validate_key(raw_key)
        assert m2["requests_made"] == 1  # was 1, now bumped to 2
        m3 = store.validate_key(raw_key)
        assert m3["requests_made"] == 2  # was 2, now bumped to 3

    def test_resolve_consumer_with_valid_bearer(self, store):
        raw_key, consumer_id = store.create_api_key("Bearer")
        resolved = store.resolve_consumer(f"Bearer {raw_key}")
        assert resolved == consumer_id

    def test_resolve_consumer_no_auth(self, store):
        assert store.resolve_consumer(None) == "default-consumer"

    def test_resolve_consumer_invalid_key(self, store):
        assert store.resolve_consumer("Bearer sk-ie-nonexistent1234567890abcdef") == "default-consumer"

    def test_resolve_consumer_empty_string(self, store):
        assert store.resolve_consumer("") == "default-consumer"

    def test_list_keys_shows_all(self, store):
        store.create_api_key("K1")
        store.create_api_key("K2")
        keys = store.list_keys()
        # At least default + K1 + K2
        names = [k["name"] for k in keys]
        assert "K1" in names
        assert "K2" in names

    def test_list_keys_no_raw_values(self, store):
        """Raw key material should never appear in list_keys output."""
        raw, _ = store.create_api_key("Secret")
        keys = store.list_keys()
        for k in keys:
            for v in k.values():
                if isinstance(v, str):
                    assert not v.startswith("sk-ie-"), "Raw key leaked in list_keys"

    def test_default_key_property(self, store):
        """The store exposes a default_key that validates successfully."""
        dk = store.default_key
        assert dk.startswith("sk-ie-")
        meta = store.validate_key(dk)
        assert meta is not None
        assert meta["consumer_id"] == "default-consumer"


# ---------------------------------------------------------------------------
# Billing — charge_request
# ---------------------------------------------------------------------------


class TestBilling:
    """charge_request: deductions, credits, financial invariant, min charge."""

    def _make_consumer(self, store) -> tuple[str, str]:
        return store.create_api_key("Test Consumer")

    def test_charge_deducts_from_consumer(self, store):
        raw, cid = self._make_consumer(store)
        before = store.get_account(cid)["balance_micro"]
        store.charge_request("r1", cid, "p1", "m", 10_000, 5_000, 1.0, 2.0)
        after = store.get_account(cid)["balance_micro"]
        assert after < before

    def test_charge_credits_provider(self, store):
        _, cid = self._make_consumer(store)
        store.charge_request("r1", cid, "prov-1", "m", 10_000, 5_000, 1.0, 2.0)
        prov = store.get_account("prov-1")
        assert prov is not None
        assert prov["total_earned_micro"] > 0

    def test_financial_invariant(self, store):
        """cost = provider_earning + platform_fee for every charge."""
        _, cid = self._make_consumer(store)
        bill = store.charge_request("r1", cid, "p1", "m", 100_000, 50_000, 1.0, 2.0)
        assert bill["cost_micro"] == bill["provider_earning_micro"] + bill["platform_fee_micro"]

    @pytest.mark.parametrize(
        "in_tok, out_tok, p_in, p_out",
        [
            (1, 1, 0.01, 0.01),
            (100, 50, 0.50, 1.00),
            (10_000, 5_000, 2.00, 4.00),
            (1_000_000, 500_000, 1.00, 3.00),
        ],
    )
    def test_financial_invariant_across_sizes(self, store, in_tok, out_tok, p_in, p_out):
        _, cid = self._make_consumer(store)
        bill = store.charge_request(f"r-{in_tok}", cid, "p1", "m", in_tok, out_tok, p_in, p_out)
        assert bill["cost_micro"] == bill["provider_earning_micro"] + bill["platform_fee_micro"]

    def test_minimum_charge(self, store):
        """Even a trivially small request costs at least $0.0001 (100 micro-USD)."""
        _, cid = self._make_consumer(store)
        bill = store.charge_request("r-tiny", cid, "p1", "m", 1, 1, 0.01, 0.01)
        assert bill["cost_micro"] >= 100

    def test_no_money_lost_across_many_charges(self, store):
        """Sum of provider earnings + platform fees = sum of consumer costs."""
        _, cid = self._make_consumer(store)
        bills = []
        for i in range(50):
            b = store.charge_request(
                f"r-{i}", cid, "p1", "m",
                100 * (i + 1), 50 * (i + 1), 1.0, 2.0,
            )
            bills.append(b)

        total_cost = sum(b["cost_micro"] for b in bills)
        total_earned = sum(b["provider_earning_micro"] for b in bills)
        total_fees = sum(b["platform_fee_micro"] for b in bills)
        assert total_cost == total_earned + total_fees

    def test_platform_fee_is_ten_percent(self, store):
        """Platform takes a 10% fee."""
        _, cid = self._make_consumer(store)
        bill = store.charge_request("r1", cid, "p1", "m", 1_000_000, 0, 1.0, 0.0)
        # 1M input tokens at $1/Mtok = $1 = 1_000_000 micro
        expected_fee = bill["cost_micro"] * 10 // 100
        assert bill["platform_fee_micro"] == expected_fee


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


class TestTransactions:
    """Transaction history queries."""

    def test_recent_transactions_reverse_chrono(self, store):
        _, cid = store.create_api_key("Chrono")
        for i in range(5):
            store.charge_request(f"r-{i}", cid, "p1", "m", 1000, 500, 1.0, 1.0)

        txns = store.recent_transactions(limit=5)
        timestamps = [t["timestamp"] for t in txns]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_recent_transactions_respects_limit(self, store):
        _, cid = store.create_api_key("Limit")
        for i in range(10):
            store.charge_request(f"r-{i}", cid, "p1", "m", 1000, 500, 1.0, 1.0)

        txns = store.recent_transactions(limit=3)
        assert len(txns) == 3

    def test_billing_summary_aggregates(self, store):
        _, cid = store.create_api_key("Summary")
        for i in range(5):
            store.charge_request(f"r-{i}", cid, "p1", "m", 1000, 500, 1.0, 2.0)

        summary = store.billing_summary()
        assert summary["total_requests"] == 5
        assert summary["total_volume_usd"] > 0
        assert summary["total_tokens"] > 0
        assert summary["accounts"] >= 2  # default-consumer + the key's account

    def test_billing_summary_empty_store(self, store):
        summary = store.billing_summary()
        assert summary["total_requests"] == 0
        assert summary["total_volume_usd"] == 0.0
        assert summary["total_tokens"] == 0


# ---------------------------------------------------------------------------
# Persistence — data survives a new Store instance on the same DB
# ---------------------------------------------------------------------------


class TestPersistence:
    """Simulate a restart by creating a fresh Store on the same file."""

    def test_account_survives_restart(self, db_path):
        s1 = Store(db_path=db_path)
        s1.get_or_create_account("persist-user", "Persistent")
        del s1

        s2 = Store(db_path=db_path)
        acct = s2.get_account("persist-user")
        assert acct is not None
        assert acct["name"] == "Persistent"

    def test_balance_survives_restart(self, db_path):
        s1 = Store(db_path=db_path)
        raw_key, cid = s1.create_api_key("Restarter")
        s1.charge_request("r1", cid, "p1", "m", 100_000, 50_000, 1.0, 2.0)
        balance_before = s1.get_account(cid)["balance_micro"]
        del s1

        s2 = Store(db_path=db_path)
        balance_after = s2.get_account(cid)["balance_micro"]
        assert balance_after == balance_before

    def test_transactions_survive_restart(self, db_path):
        s1 = Store(db_path=db_path)
        _, cid = s1.create_api_key("TX")
        for i in range(3):
            s1.charge_request(f"r-{i}", cid, "p1", "m", 1000, 500, 1.0, 1.0)
        del s1

        s2 = Store(db_path=db_path)
        txns = s2.recent_transactions(limit=10)
        assert len(txns) >= 3

    def test_provider_history_survives_restart(self, db_path):
        s1 = Store(db_path=db_path)
        s1.log_provider_connect("prov-x", "Provider X", "apple-m4", "verified", 1.0, 50.0)
        del s1

        s2 = Store(db_path=db_path)
        # Verify by querying directly (no dedicated getter, use recent query)
        row = s2._conn.execute(
            "SELECT * FROM provider_history WHERE provider_id = ?", ("prov-x",)
        ).fetchone()
        assert row is not None
        assert row["provider_name"] == "Provider X"


# ---------------------------------------------------------------------------
# Provider History
# ---------------------------------------------------------------------------


class TestProviderHistory:
    """log_provider_connect and log_provider_disconnect."""

    def test_log_connect_creates_record(self, store):
        store.log_provider_connect("p1", "ProvA", "apple-m4-pro", "verified", 2.0, 60.0)
        row = store._conn.execute(
            "SELECT * FROM provider_history WHERE provider_id = ?", ("p1",)
        ).fetchone()
        assert row is not None
        assert row["provider_name"] == "ProvA"
        assert row["hardware"] == "apple-m4-pro"
        assert row["trust_level"] == "verified"
        assert row["disconnected_at"] is None

    def test_log_disconnect_updates_timestamp(self, store):
        store.log_provider_connect("p2", "ProvB", "nvidia-rtx4090", "basic", 1.5, 120.0)
        store.log_provider_disconnect("p2")
        row = store._conn.execute(
            "SELECT * FROM provider_history WHERE provider_id = ?", ("p2",)
        ).fetchone()
        assert row["disconnected_at"] is not None

    def test_disconnect_only_affects_active_session(self, store):
        """Disconnect should only update rows where disconnected_at is NULL."""
        store.log_provider_connect("p3", "ProvC", "hw", "basic", 1.0, 10.0)
        store.log_provider_disconnect("p3")

        # Connect again
        store.log_provider_connect("p3", "ProvC", "hw", "basic", 1.0, 10.0)

        rows = store._conn.execute(
            "SELECT * FROM provider_history WHERE provider_id = ? ORDER BY connected_at",
            ("p3",),
        ).fetchall()

        assert len(rows) == 2
        # First session: disconnected
        assert rows[0]["disconnected_at"] is not None
        # Second session: still active
        assert rows[1]["disconnected_at"] is None
