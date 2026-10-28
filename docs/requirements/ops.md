# OPS: Operations

### OPS-001: Production needs a session secret

MUST: In production, the coordinator does not start if `IE_JWT_SECRET` is not set.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestProdMode::test_requires_jwt_secret

### OPS-002: Metrics can be protected

MUST: If `IE_METRICS_TOKEN` is set, `/metrics` needs that token as a bearer token.

- Principle: P6
- Status: implemented
- Verified by: tests/test_metrics.py::test_metrics_token

### OPS-003: TLS on the public internet

MUST: The production deployment uses TLS for all public traffic.

- Principle: P6
- Status: partial
- Issue: #70

Note: `deploy/Caddyfile` provides TLS. CI validates the Caddyfile, but no test checks TLS. Status changes to `implemented` when a deploy smoke test exists.

### OPS-004: Database backups

MUST: The production database is replicated to object storage continuously. A new server restores the latest copy at first start.

- Principle: P8
- Status: partial
- Issue: #71

Note: `deploy/docker-compose.yml` configures Litestream. No restore test exists yet.

### OPS-005: Infrastructure as code

MUST: All production infrastructure is defined in `infra/` and is public.

- Principle: P2, P8
- Status: partial
- Issue: #70

### OPS-006: Tests do not touch real data

MUST NOT: The test suite writes to the user database at `~/.inference-exchange/exchange.db`.

- Principle: P9
- Status: implemented
- Verified by: tests/conftest.py::_isolated_db

### OPS-007: Signed release artifacts

MUST: Each release has signed artifacts and published build provenance.

- Principle: P4
- Status: not-implemented
- Issue: #68

### OPS-008: Operators can pause inference

MUST: An admin can pause inference without a restart. While inference is paused, the system returns HTTP 503 with the type `inference_paused` to each new inference request. A request that is in progress can complete. `IE_INFERENCE_PAUSED=1` pauses inference at start-up.

- Principle: P6
- Status: implemented
- Verified by: tests/test_operator_controls.py::TestInferencePause::test_admin_pause_rejects_new_inference, tests/test_operator_controls.py::TestInferencePause::test_pause_from_env, tests/test_operator_controls.py::TestInferencePause::test_pause_covers_confidential_path, tests/test_operator_controls.py::TestControlsNeedAdmin::test_non_admin_denied

### OPS-009: Operators can stop new sign-ups

MUST: An admin can stop new sign-ups without a restart. While sign-ups are stopped, the system does not create a new account. An existing user can still sign in. `IE_SIGNUP_DISABLED=1` stops sign-ups at start-up.

- Principle: P6
- Status: implemented
- Verified by: tests/test_operator_controls.py::TestSignupSwitch::test_signup_disabled_blocks_new_accounts_only, tests/test_operator_controls.py::TestSignupSwitch::test_signup_disabled_blocks_new_github_identity

### OPS-010: Bounded load per account and in the queue

MUST: The system limits the number of simultaneous inference requests for each account. The default limit is 2 (`IE_MAX_CONCURRENT_PER_ACCOUNT`). A request above the limit gets HTTP 429 with the type `concurrency_limit`.

MUST: The request queue has a maximum length (`IE_QUEUE_MAX_DEPTH`) and a maximum wait (`IE_QUEUE_TIMEOUT_SECONDS`). An admin can clear the queue. A cleared request gets HTTP 503 with the type `queue_cleared`.

Note: These limits protect providers from overload. They are not daily quotas.

- Principle: P6
- Status: implemented
- Verified by: tests/test_operator_controls.py::TestConcurrencyLimit::test_extra_simultaneous_request_rejected, tests/test_operator_controls.py::TestConcurrencyLimit::test_limit_is_per_account, tests/test_operator_controls.py::TestConcurrencyLimit::test_slot_released_after_stream, tests/test_operator_controls.py::TestConcurrencyLimit::test_slot_released_after_failed_request, tests/test_operator_controls.py::TestQueueControls::test_queue_settings_from_env, tests/test_operator_controls.py::TestQueueControls::test_clear_queue_releases_waiters

### OPS-011: Each route has an ingress category

MUST: Each coordinator route has one category: public, account, admin, provider, or ops. `tests/test_route_inventory.py` lists the routes. The test fails for a route that is not in the list.

MUST: The coordinator enforces each category without help from a proxy. In production, an anonymous request to an account route gets HTTP 401. An admin route gets HTTP 401 or 403 without the admin role. `/ws/provider` closes with code 4003 without a valid provider token.

MUST NOT: In production, the coordinator serves `/openapi.json`, `/docs` (Swagger UI), or `/redoc`. In production, `/metrics` returns HTTP 404 if `IE_METRICS_TOKEN` is not set.

Note: Cloudflare Access on `/admin` and `/v1/admin/*` is an added edge control. The tests cannot verify it. See `docs/guides/alpha-access-rollout.md`.

- Principle: P6
- Status: implemented
- Verified by: tests/test_route_inventory.py::test_every_route_is_classified, tests/test_route_inventory.py::test_account_routes_need_credentials_in_prod, tests/test_route_inventory.py::test_admin_routes_need_admin_in_prod, tests/test_route_inventory.py::test_provider_socket_needs_token_in_prod, tests/test_route_inventory.py::test_api_schema_and_docs_hidden_in_prod, tests/test_route_inventory.py::test_metrics_hidden_in_prod_without_token
