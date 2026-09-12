# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Inference Exchange, please report it privately:

**Email:** security@inference.exchange

Do **not** open a public GitHub issue for security vulnerabilities.

## What Counts as a Security Issue

- Any bypass of the L2 process hardening boundary (reading inference plaintext from outside the provider process via user-space mechanisms)
- Any path where the coordinator can access plaintext content on the confidential inference path
- Cryptographic weaknesses in the E2E session protocol (key exchange, encryption, replay protection)
- API key or credential exposure
- Bypass of authentication or authorization
- Billing manipulation (creating or destroying value)

## What Is NOT a Security Issue

- Denial of service (the provider operator can always kill the process — this is an availability property, not confidentiality)
- Kernel-level or physical attacks (explicitly out of scope for L2)
- Provider metadata visibility (CPU/RAM usage, process lists, network timing)
- Bugs in non-security code (matching algorithm, dashboard, CLI)

## Disclosure Policy

- We will acknowledge receipt within 48 hours
- We will provide an initial assessment within 7 days
- We follow coordinated disclosure: please allow 90 days before public disclosure
- We will credit reporters in the security advisory (unless you prefer anonymity)

## Scope

The current alpha scope is defined in:

- [L2 Threat Model](docs/security/threat-model.md)
- [Alpha Protocol Spec](docs/security/alpha-protocol-spec.md)
- [PCC Comparison](docs/security/pcc-comparison.md)

The L2 security boundary assumes: Apple Silicon, macOS 14+, SIP enabled, Hardened Runtime, no `get-task-allow`. Attacks that disable these protections first are outside the L2 claim.
