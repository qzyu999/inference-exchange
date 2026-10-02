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
