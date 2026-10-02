# ROUTE: Routing

### ROUTE-001: Obey the minimum trust level

MUST NOT: The system sends a request to a provider below the minimum trust level of the request.

- Principle: P1
- Status: implemented
- Verified by: tests/test_matching.py::TestGreedyStrategy::test_min_confidence_filter

### ROUTE-002: Obey the price ceiling

MUST NOT: The system sends a request to a provider above the price ceiling of the request.

- Principle: P1
- Status: partial
- Verified by: tests/test_matching.py::TestGreedyStrategy::test_price_cap_filter
- Issue: #52

Note: The ceiling applies to the output price only.

### ROUTE-003: Session affinity obeys constraints

MUST: Session affinity does not override the trust level or the price ceiling.

- Principle: P1
- Status: implemented
- Verified by: tests/test_session_affinity.py::TestAffinityConstraints::test_affinity_skipped_if_confidence_too_low, tests/test_session_affinity.py::TestAffinityConstraints::test_affinity_skipped_if_price_too_high

### ROUTE-004: Preferences change the selection

MUST: The preferences `cheapest`, `fastest`, and `most_secure` change which provider the system selects.

- Principle: P3
- Status: implemented
- Verified by: tests/test_matching.py::TestGreedyStrategy::test_cheapest_preference, tests/test_matching.py::TestGreedyStrategy::test_fastest_preference, tests/test_matching.py::TestGreedyStrategy::test_most_secure_preference

### ROUTE-005: The queue has a limit

MUST: The request queue has a maximum depth. When the queue is full, the system rejects new requests.

- Principle: P8
- Status: implemented
- Verified by: tests/test_request_queue.py::TestQueueFull::test_queue_full_raises

### ROUTE-006: Reject invalid input

MUST: The system rejects a request with empty messages, more than 100 messages, or `max_tokens` or `temperature` out of range. The response is HTTP 400.

- Principle: P6
- Status: implemented
- Verified by: tests/test_routes_inference.py::TestInputValidation::test_rejects_empty_messages, tests/test_routes_inference.py::TestInputValidation::test_rejects_too_many_messages, tests/test_routes_inference.py::TestInputValidation::test_rejects_invalid_temperature, tests/test_routes_inference.py::TestInputValidation::test_rejects_invalid_max_tokens

### ROUTE-007: Reject input above the context limit

MUST: If the input is larger than the context limit of every eligible provider, the system rejects the request with a clear error.

- Principle: P1
- Status: not-implemented
- Issue: #32

### ROUTE-008: Fallback obeys trust

MUST: If a provider fails, the system can try a different provider. The new provider must meet the same trust level and price ceiling.

- Principle: P1
- Status: not-implemented
- Issue: #13

### ROUTE-009: External providers need opt-in

MUST NOT: The system sends a request to an external provider, unless the consumer opts in for that request.

- Principle: P1, P5
- Status: not-implemented
- Issue: #67
