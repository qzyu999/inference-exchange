# AGENTS.md

Guidance for AI coding agents working in this repository.

## Source of truth

`docs/principles.md` and `docs/requirements/*.md` define what the system must do. The code implements them.

- Before you change behaviour, find the requirement that covers it. If none exists, propose one. Do not add requirements silently.
- Only the project owner approves a new or changed requirement. Put the requirement change in the same commit as the code.
- When a requirement becomes `implemented`, add its test to **Verified by**, then run `python scripts/check_requirements.py`.
- Do not reuse or renumber requirement IDs.
- `docs/archive/` is background only. If it disagrees with a requirement, the requirement wins.

## Writing docs

Write docs in ASD-STE100 Simplified Technical English: one instruction per sentence, active voice, short sentences, one word for one meaning ("provider", not "node").

## Keep the project vendor-neutral

- Do not commit employer names, internal hostnames, private registries, or machine-specific paths.
- Do not commit secrets. Configuration that differs per deployment goes in `deploy/.env` (gitignored).
- Do not add workarounds that weaken security for one network, such as disabling TLS verification.

## Build and test

```bash
pip install -e ".[dev]"
pytest tests -q --ignore=tests/load_test.py --ignore=tests/local_e2e_test.py \
  --ignore=tests/test_integration.py --ignore=tests/test_preferences.py \
  --deselect tests/test_openai_sdk.py
python scripts/check_requirements.py
cd web && npm ci && npm run build && node src/lib/docs.test.mjs && node src/lib/money.test.mjs && node src/lib/nav.test.mjs && node src/lib/key-creation.test.mjs
```

Use the mock provider when you do not have a model: `python -m inference_exchange.provider --mock --trust hardened`.

## Test-first engineering and compositional verification

Use [the testing strategy](docs/testing-strategy.md) for test levels, fixtures, and evidence.
These rules support the approved requirements. They do not replace them.

- Identify the approved requirement IDs and current tests before a behavior change.
- For new behavior or a reproduced defect, write a failing test first when practical.
- Confirm the intended failure. Make the smallest fix, then refactor and rerun the tests.
- Before a risky legacy refactor, characterize intended behavior in tests. Do not preserve a known defect as a requirement.
- Use unit, component, contract, integration, property, and E2E tests as needed for the risk.
- Check affected callers, interfaces, persistent data, and downstream journeys. A unit-only pass is not system evidence.
- Preserve exact integer billing, stable provider identity, owner isolation, routing constraints, and safe failure behavior.
- Use isolated SQLite, deterministic fixtures, and mock providers in CI. Never test against production data or secrets.
- Reuse pytest, existing web tests, and current CI. Do not add duplicate frameworks without a clear need.
- Update a requirement's `Verified by` test as needed. Run affected tests and `python scripts/check_requirements.py`.
- In each PR and issue, record the red/green evidence, commands, CI results, regression coverage, and unverified paths.
- Report source, merge, deployment, hardware, and independent acceptance as separate states. Never claim unrun checks passed.
- Explain exceptions, such as exploratory prototypes, in the PR. Add suitable tests before production qualification.
- Do not change production services, credentials, data, or configuration, or run a canary, without explicit operator approval.
