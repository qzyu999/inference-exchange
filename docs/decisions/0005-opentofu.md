# 0005: OpenTofu for infrastructure as code

- Status: Accepted
- Date: 2026-10-01
- Principles: P2, P8

## Context

All production infrastructure must be in the public repository (OPS-005). Terraform 1.6 and later uses the Business Source License, which is not an OSI open-source license.

## Decision

Use OpenTofu (MPL 2.0). Keep the configuration compatible with Terraform 1.6 or later.

## Consequences

- The tool is open source and free. The cloud resources cost money.
- CI runs `tofu validate` on `infra/`.
