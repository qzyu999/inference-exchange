# Analytics

### ANALYTICS-001: Durable bounded operational outcomes

MUST: Keep recorded routing decisions in SQLite separately from financial transactions. Use a full request ID. Updates keep the original timestamp and list position. Owner and admin access follow PRIV-001 and PRIV-002. Sort newest first, with request ID as the tie breaker. Return at most 30 records by default. An authorized caller can open an exact retained request ID through `/v1/exchange/traces/{request_id}`. Other owners receive HTTP 404.

MUST: Retain operational records for seven days with a maximum of 10,000 rows across the exchange. Prune on reads and writes, at startup, and at least once per minute while running. Do not prune the financial ledger with this policy. Mark unfinished routed records as interrupted at startup. A match alone is not a completion. Completion means that the provider finished and settlement succeeded; it does not prove client receipt. Known provider errors are failures. Other unfinished requests stay unconfirmed until restart. This history is not an exhaustive HTTP access log.

MUST: Private frontend caches reset on account or admin-role changes. Do not show another account's cached history after logout or sign-in.

- Principle: P2, P3, P6, P8
- Status: implemented
- Verified by: tests/test_network_analytics.py, tests/test_access_control.py, web/src/lib/request-outcomes.test.mjs
- Issue: #248

### ANALYTICS-002: Consistent financial scopes

MUST: Label Overview spend as exchange-wide and all time. Label Billing spend as personal and all time. Use the shared USD formatter. Compute the personal model breakdown from all settled transactions for that account, with integer micro-USD. Do not use a paginated transaction list for all-time totals. Label unknown served models without guessing. Keep the recent charge list separate from all-time usage. Do not change settlement or balances for analytics.

- Principle: P3, P7, P8
- Status: implemented
- Verified by: tests/test_network_analytics.py, web/src/lib/money.test.mjs
- Issue: #248

### ANALYTICS-003: Admin account signup counts

MUST: `/v1/admin/signups` requires IE administrator access. Count existing user identities, not billing accounts, visits, API keys, or inferred people. Show total existing accounts, accounts created today, and accounts created in the latest 30 UTC calendar days. Include zero-count days. Deleted accounts are excluded. Repeat logins do not create signups.

MUST: Store an optional trusted country at account creation only, using GEO-001 ingress checks and exclusion header. Do not replace this value on later logins. Historical unknown countries stay unknown. Only administrator aggregate reports may publish this field. Labels must explain that connection country is approximate and test accounts are included.

- Principle: P2, P3, P6, P8
- Status: implemented
- Verified by: tests/test_network_analytics.py, tests/test_route_inventory.py
- Issue: #248
