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
