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

- Principle: P2
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestKeysAndAccount::test_delete_account

### PRIV-008: Prompts are not logged

MUST NOT: The coordinator writes prompt or response text to logs.

- Principle: P2, P4
- Status: partial
- Issue: #7
