# BILL: Billing

### BILL-001: Books balance

MUST: For each charge, the consumer debit equals the provider credit plus the platform fee.

- Principle: P7
- Status: implemented
- Verified by: tests/test_financial_invariants.py::TestBooksBalance::test_per_bill_invariant_across_random_events, tests/test_store.py::TestBilling::test_financial_invariant

### BILL-002: Platform fee is 10 percent

MUST: The platform fee is 10 percent of the charge, rounded down. The provider gets the remainder.

- Principle: P7
- Status: implemented
- Verified by: tests/test_financial_invariants.py::TestPlatformFee::test_platform_fee_is_ten_percent, tests/test_financial_invariants.py::TestProviderSplit::test_provider_gets_ninety_percent

### BILL-003: No negative charges

MUST NOT: A charge has a negative amount.

- Principle: P7
- Status: implemented
- Verified by: tests/test_financial_invariants.py::TestNoNegativeCharges::test_no_negative_amounts

### BILL-004: Minimum charge

MUST: Each billed request costs at least $0.0001.

- Principle: P7
- Status: implemented
- Verified by: tests/test_store.py::TestBilling::test_minimum_charge

### BILL-005: Zero balance stops requests

MUST: If the balance is zero or less, the system rejects the request with HTTP 402.

- Principle: P7
- Status: partial
- Issue: #59

Note: The code rejects at a balance of zero or less. Billing is post-pay, so a balance can go below zero by the cost of one request.

### BILL-006: Served requests are billed

MUST: When a provider completes a request, the system bills the consumer.

- Principle: P7
- Status: implemented
- Verified by: tests/test_mock_provider_e2e.py::test_chat_through_mock_provider_is_served_and_billed

### BILL-007: Partial streams are billed for delivered tokens

MUST: If a stream fails or the consumer cancels it, bill only for the tokens that the provider delivered.

- Principle: P7
- Status: not-implemented
- Issue: #59

### BILL-008: Balances persist

MUST: Accounts, balances, and transactions survive a coordinator restart.

- Principle: P7
- Status: implemented
- Verified by: tests/test_store.py::TestPersistence::test_balance_survives_restart, tests/test_store.py::TestPersistence::test_transactions_survive_restart

### BILL-009: Billing amounts are exact and disclosed

MUST: The UI shows a nonzero amount with enough digits that it does not look like zero. It shows `$0.00` only for an exact zero. All billing pages use the same formatter (`web/src/lib/money.js`).

MUST: `GET /v1/exchange/history` gives each charge in integer micro-USD (`cost_micro`, `provider_earning_micro`, `platform_fee_micro`). It also gives `minimum_applied`. `minimum_applied` is true when the BILL-004 minimum, not the token prices, set the charge.

MUST: `GET /v1/exchange/billing-config` gives the minimum charge and the platform fee. The UI shows the minimum charge and labels alpha credits as simulated.

Note: This requirement does not change what the system charges. A decision to change the minimum charge is a separate requirement change.

- Principle: P7
- Status: implemented
- Verified by: tests/test_billing_disclosure.py::test_billing_config_discloses_minimum, tests/test_billing_disclosure.py::test_history_marks_minimum_and_has_exact_split, tests/test_billing_disclosure.py::test_accumulated_microcharges_reconcile_with_balance, web/src/lib/money.test.mjs

### BILL-010: Provider earnings use the stable credential principal

MUST: A newly billed request credits the stable provider billing account. Each new transaction separately records the WebSocket session for audit. Consumer debit equals the stable provider credit plus the platform fee.

MUST NOT: A migration automatically merge old `provider-N` balances or assign their history to a credential from a provider name. Existing balances and transactions stay unchanged.

- Principle: P7
- Status: implemented
- Verified by: tests/test_provider_billing_identity.py::test_two_credentials_same_display_name_never_cross_credit, tests/test_provider_billing_identity.py::test_legacy_migration_is_idempotent_and_preserves_balances
- Issue: #136

### BILL-011: Private provider earnings are exact simulated credits

MUST: An authenticated IE provider owner can read the earned credits, fees, and request count for their owned nodes. The API uses integer micro-USD and labels earnings as simulated. It shows transaction earnings and recorded account earnings separately, and reports when they do not match.

MUST NOT: The system counts a provider account's initial simulated credit grant as earnings. The owner view does not transfer, pool, or pay out credits. The query does not modify transactions or account balances.

- Principle: P7, P9
- Status: implemented
- Verified by: tests/test_provider_earnings_private.py::test_multi_node_exact_earnings_and_pagination, tests/test_provider_earnings_private.py::test_balance_grant_not_counted_as_earnings_and_reconciliation
- Issue: #152


### BILL-012: Explicit alpha provider ledger consolidation

MUST: A one-time alpha consolidation requires an operator to select the active SQLite database, attest that all historical provider connection accounts belong to one provider, select the credential-backed canonical principal, and approve the exact expected row counts. The tool makes a private, integrity-checked SQLite backup and rehearses the migration on a copy before it can change the selected database.

MUST: The write uses one atomic transaction. It preserves every transaction ID, consumer, model, token count, price and amount. It stores the old provider-account rows and each original transaction provider ID in immutable migration archive tables. It reassigns only the approved historical provider attribution. It credits the canonical account only with previously earned micro-USD. It never combines repeated provider opening grants.

MUST: Before writing, the tool checks that exactly one active provider credential exists, every legacy account reconciles to its transaction earnings and initial simulated grant, and the source has not changed since the backup. A failed check leaves the database unchanged. A second run cannot credit earnings twice.

MUST NOT: Provider ownership be inferred automatically from a display name, IP address, model, or WebSocket connection. A normal coordinator startup must not run this procedure. The operator must separately authorize any production run after a reviewed rehearsal.

- Principle: P7, P9
- Status: implemented
- Verified by: tests/test_legacy_provider_consolidation.py::test_rehearsal_backs_up_wal_and_never_mutates_source, tests/test_legacy_provider_consolidation.py::test_explicit_apply_remaps_exact_history_and_ignores_starting_grants, tests/test_legacy_provider_consolidation.py::test_repeat_does_not_double_credit_and_fails_closed, tests/test_legacy_provider_consolidation.py::test_live_drift_after_backup_aborts_before_any_migration, tests/test_legacy_provider_consolidation.py::test_failed_transaction_rolls_back_all_archive_and_money
- Issue: #136

### BILL-013: Price precision is six decimal places

MUST: A token price in USD per million tokens has at most 6 decimal places. The smallest price step is $0.000001. The coordinator rejects a provider registration with a more precise price.

MUST: The system calculates each charge tier as tokens multiplied by the price, in exact decimal arithmetic. It rounds the result down to an integer micro-USD.

MUST: The UI shows each price with at least 2 and at most 6 decimal places. It shows a nonzero price with enough digits that it does not look like zero. All price displays use the same formatter (`web/src/lib/price.js`).

Note: Reference prices from external sources can have more digits. The system rounds them to 6 decimal places for display and comparison. It does not bill them.

- Principle: P7
- Status: implemented
- Verified by: tests/test_price_precision.py::test_price_precision_limit, tests/test_price_precision.py::test_cost_is_exact_and_rounds_down, tests/test_price_precision.py::test_cost_matches_integer_reference_for_random_prices, tests/test_price_precision.py::test_store_charge_uses_exact_arithmetic, tests/test_provider_registration_validation.py::test_too_precise_price_rejected, web/src/lib/price.test.mjs
- Issue: #275

## Paid path

These requirements apply to paid-path accounts in live mode and test mode (decision 0010). They do not change simulated alpha accounts. Design: [paid-path architecture](../design/paid-path-architecture.md). Model: `formal/paid/PaidPath.tla`.

### BILL-014: Money is recorded as double-entry postings

MUST: Each money event is one ledger transaction with a unique idempotency key. Its postings are integer micro-USD and sum to zero. The database rejects a commit where they do not.
MUST NOT: The system update or delete a posting. A correction is a new transaction.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-015: A hold comes before dispatch

MUST: Before the first upstream call, the system holds the maximum charge of the selected route in one transaction. If available funds do not cover it, the system returns HTTP 402 and calls no upstream.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-016: One charge per request, within its hold

MUST: A paid request has at most one charge. Only the active attempt, from the session that received it, can settle it. The charge is not more than the hold.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-017: Upstream usage is validated

MUST: The system charges usage only if each count is a non-negative integer, cached tokens are not more than prompt tokens, completion tokens are not more than `max_tokens`, prompt tokens are not more than the input bound, and one terminal event reports it. Invalid usage is not charged. The hold is released and a reconciliation item records the reason.

- Principle: P7, P3
- Status: not-implemented
- Issue: #297

### BILL-018: The input bound needs no tokenizer

MUST: The input bound of a request is its prompt size in UTF-8 bytes plus a stated overhead for each message. A registered tokenizer for the exact model can give a lower bound. The hold uses the bound at the input rate.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-019: Interrupted streams are billed by cause

MUST: If the client ends a stream, the system charges the delivered lower bound: the count of content deltas that the client received at the output rate, plus the minimum input charge, not more than the hold. If a vendor, a provider or IE ends the stream, the system releases the hold. #332 reviews this rule.

- Principle: P7
- Status: not-implemented
- Issue: #332

### BILL-020: Paid and sponsored credit stay separate

MUST: Sponsored credit is used first, then paid lots oldest first. A refund draws only on paid credit that is not held, from the rail that funded it.
MUST NOT: A refund pay out sponsored credit or credit that a request holds.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-021: A payment credits once

MUST: A rail event is stored by `(rail_id, rail_event_id)` before it is processed. A payment credits its order at most once. An amount, currency or account that does not match the order is not credited and becomes a reconciliation item.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-022: External money effects go through the outbox

MUST: A refund or other external money effect starts only from a committed outbox row. The worker sends it with the IE ID as the idempotency key. Before a retry after the rail's idempotency window, the worker looks up the effect by the IE ID.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-023: Every possibly-sent vendor call is tracked

MUST: The attempt row commits before the vendor call. Each vendor attempt that is not settled or definitely rejected gets a reconciliation item, also after a restart. The system never sends the same inference call again.

- Principle: P7
- Status: not-implemented
- Issue: #313

### BILL-024: Limits are settings

MUST: The vendor daily spend cap, the account balance and daily spend cap, and the platform-wide daily absorbed-cost cap are settings that an admin can change. Each change writes an audit row. A request that would pass a cap is rejected before its hold.

Note: Alpha defaults are a vendor cap of $10 a day, an account cap of $20 and an absorbed-cost cap of $5 a day across the platform.

- Principle: P7
- Status: not-implemented
- Issue: #297

### BILL-025: Live and test money never mix

MUST: Each account, key, lot, transaction, posting, request and rail event has one mode. A record cannot refer to a record of the other mode. Test mode uses only the rail sandbox and mock vendors.

- Principle: P7, P6
- Status: not-implemented
- Issue: #297

### BILL-026: Request outcome lookup and idempotency keys

MUST: Each paid response carries `X-IE-Request-Id` before any output. `GET /v1/requests/{id}` returns the owner's request phase and receipt, never the completion. A retry with the same `Idempotency-Key` and body returns the first outcome. The same key with a different body returns HTTP 422.

- Principle: P7, P2
- Status: not-implemented
- Issue: #297
