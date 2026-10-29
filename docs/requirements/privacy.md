# PRIV: Privacy and public data

### PRIV-001: Traces belong to their owner

MUST: `GET /v1/exchange/traces` returns only the traces of the caller. An admin gets all traces.

- Principle: P2
- Status: implemented
- Verified by: tests/test_access_control.py::TestTraceAndEventPrivacy::test_traces_scoped_to_caller

### PRIV-002: The trace owner is not exposed

MUST NOT: A trace response contains the internal owner field.

- Principle: P2
- Status: implemented
- Verified by: tests/test_access_control.py::TestTraceAndEventPrivacy::test_trace_owner_field_not_exposed

### PRIV-003: Public events contain no identifiers

MUST: The public event feed (`/ws/events` and `/v1/exchange/events/recent`) removes `consumer_id` and `request_id` from each event.

- Principle: P2
- Status: implemented
- Verified by: tests/test_access_control.py::TestTraceAndEventPrivacy::test_public_event_strips_identifiers

### PRIV-004: Trust is labelled as claimed or verified

MUST: The provider list shows the claimed trust level and the verified trust level as separate fields. If there is no evidence, the basis is `self_reported`.

- Principle: P3
- Status: implemented
- Verified by: tests/test_access_control.py::TestTraceAndEventPrivacy::test_unverified_trust_is_labelled_self_reported

### PRIV-005: Metrics contain no identifiers

MUST: `/metrics` labels requests by route template. It does not include path values, user IDs, or key IDs.

- Principle: P2
- Status: implemented
- Verified by: tests/test_metrics.py::test_metrics_exposes_gauges_and_route_templates

### PRIV-006: Public aggregates are not targetable

MUST: Public metrics are aggregates in time buckets. Do not publish a bucket that has fewer than k requests.

- Principle: P2
- Status: not-implemented
- Issue: #38

### PRIV-007: Delete account

MUST: A signed-in user can delete their account. The delete removes the identity, the API keys, and the balance.

MUST: While the account owns provider nodes, deletion fails with HTTP 409. The system does not orphan provider credentials or ledger principals. Provider offboarding needs a separately reviewed procedure.

- Principle: P2
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestKeysAndAccount::test_delete_account, tests/test_provider_ownership.py::test_delete_with_provider_nodes_requires_offboarding

### PRIV-008: Prompts are not logged

MUST NOT: The coordinator writes prompt or response text to logs.

- Principle: P2, P4
- Status: partial
- Issue: #7

### PRIV-009: Private provider account information

MUST: A signed-in, non-suspended IE user can view only their owned provider nodes, live status, and provider earnings. An unknown or another owner's node filter returns HTTP 404.

MUST NOT: A consumer API key, provider WebSocket token, or anonymous request grants provider-owner access. A read-only provider-owner response or credential metadata response exposes a consumer ID, raw credential, credential hash, request ID, or request content. Only the successful credential issuance response in PROV-018 may contain a newly created raw credential.

- Principle: P2, P6, P9
- Status: implemented
- Verified by: tests/test_provider_earnings_private.py::test_cross_owner_and_anonymous_requests_fail_closed, tests/test_provider_earnings_private.py::test_revoked_suspended_and_bad_sessions_fail_closed, tests/test_provider_earnings_private.py::test_owned_node_status_and_secret_redaction
- Issue: #152
