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

### ROUTE-010: Fail fast when no provider can match

MUST: If no connected provider can serve the model, the minimum trust level, and the price ceiling of a request, the system returns HTTP 503 immediately. The request does not wait in the queue. The error message identifies the constraint that failed and the nearest available value.

MUST NOT: The system lowers the trust level of the request to find a provider.

Note: If a provider can serve the request but is busy, the request waits in the queue.

- Principle: P1
- Status: implemented
- Verified by: tests/test_fail_fast_routing.py::TestEndpoint::test_hardened_default_with_open_provider_fails_fast, tests/test_fail_fast_routing.py::TestEndpoint::test_no_provider_fails_fast, tests/test_fail_fast_routing.py::TestEndpoint::test_trust_is_not_downgraded, tests/test_fail_fast_routing.py::TestExplainNoMatch::test_trust_mismatch_names_available_level, tests/test_fail_fast_routing.py::TestExplainNoMatch::test_unknown_model, tests/test_fail_fast_routing.py::TestExplainNoMatch::test_price_ceiling, tests/test_fail_fast_routing.py::TestExplainNoMatch::test_busy_compatible_provider_can_queue

### ROUTE-011: Errors use the OpenAI format

MUST: An inference error response has the body `{"error": {"message", "type", "code"}}`, so that an OpenAI SDK can show the message.

- Principle: P2
- Status: implemented
- Verified by: tests/test_fail_fast_routing.py::TestOpenAIErrorShape::test_ocip_errors_use_openai_shape, tests/test_fail_fast_routing.py::TestOpenAIErrorShape::test_openai_sdk_reads_message

### ROUTE-012: The standard OpenAI SDK works

MUST: The standard `openai` Python package can list models and send streaming and non-streaming chat completions to the coordinator, with `extra_body` for exchange options. A request without `stream` gets one JSON response, as in the OpenAI API.

- Principle: P8
- Status: implemented
- Verified by: tests/test_mock_provider_e2e.py::test_python_sdk_guide_examples


### ROUTE-013: Require an explicit model ID for new public chat requests

MUST: A new `POST /v1/chat/completions` request names one concrete model ID in `model`.

MUST NOT: The public API silently routes a missing, null, empty, whitespace-only, or literal `default` model value. It returns HTTP 400 with an OpenAI-compatible error body containing code `invalid_model` and guidance to use `GET /v1/models`. A model ID with surrounding whitespace is also invalid.

MUST: The matching engine continues to choose an eligible provider for an explicitly named model. The routing constraints for trust, price, and capacity still apply.

MUST NOT: This API change rewrite the original requested model or money fields in historical transactions.

- Principle: P1, P2, P6, P8
- Status: implemented
- Verified by: tests/test_routes_inference.py::TestExplicitModelContract::test_rejects_missing_and_wildcard_model, tests/test_routes_inference.py::TestExplicitModelContract::test_named_model_reaches_existing_fail_fast, tests/test_mock_provider_e2e.py::test_python_sdk_guide_examples
