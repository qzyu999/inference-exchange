# Testing strategy

This guide defines the engineering test process for Inference Exchange.
It is not a product requirement.
[Principles](principles.md) and [requirements](requirements/README.md) remain the source of truth.
Only the project owner can approve a new or changed requirement.
Follow [AGENTS.md](../AGENTS.md) for agent rules.

## Test-first workflow

1. Find the approved requirement IDs and the current tests before a behavior change.
2. Reproduce a defect or define the new behavior in a failing test when practical.
3. Confirm that the test fails for the intended reason. Record the red result.
4. Make the smallest code change that makes the test pass.
5. Refactor. Run the affected tests again.
6. Test the interfaces and journeys that depend on the changed part.
7. Update the requirement's `Verified by` reference when its implementation changes.
8. Report commands, results, limits, and linked issues in the pull request.

A failing test does not approve a new behavior.
If the requirement is missing or wrong, propose a change and obtain owner approval first.
Keep the approved requirement change with its implementation, as required by `AGENTS.md`.
Do not change or reuse requirement IDs.

Before a risky legacy refactor, write characterization tests for intended behavior.
Do not turn a known defect into an approved contract.
For research prototypes or exploratory visual work, explain any test-first exception in the PR.
Add suitable regression checks before production qualification.
Do not require a test for every private function or an arbitrary coverage percentage.

## Select tests by risk and boundary

| Level | What it checks | Existing examples or next action |
| --- | --- | --- |
| Unit | Pricing, validators, matching, and error rules | `tests/test_billing.py`, `tests/test_matching.py` |
| Component | An API handler, store method, or web feature in isolation | `tests/test_routes_inference.py`, `web/src/lib/money.test.mjs` |
| Contract | HTTP response fields, OCIP messages, and stored data shapes | `tests/test_routes_inference.py`, provider registration tests |
| Integration | Auth, routing, provider ownership, persistence, and billing together | `tests/test_provider_billing_identity.py`, `tests/test_provider_self_enrollment.py` |
| Property and invariant | Rules across varied inputs and sequences | `tests/test_financial_invariants.py`, parameterized pytest cases |
| End-to-end (CI) | Real local HTTP coordinator and authenticated WebSocket mock provider | Extend `tests/test_mock_provider_e2e.py` in #212 |
| Real acceptance | Browser, release, network, and independent provider hardware | Record separately in #59 and #109 |

Use the smallest test that detects the defect.
Add a higher-level regression test when an interface or user journey is at risk.
Use table-driven or seeded randomized tests before adding a new property-testing dependency.
Reuse pytest and the existing Node test scripts.
Do not introduce a new framework without an approved need.

## Critical invariants

Treat these rules as cross-component checks, not only local calculations.

| Area | Requirement references | Checks to preserve or extend |
| --- | --- | --- |
| Accounting | BILL-001, BILL-002, BILL-004, BILL-006, BILL-009 | Integer `cost_micro == provider_earning_micro + platform_fee_micro`. Check the approved fee and minimum charge. |
| Ledger persistence | BILL-008, BILL-010, BILL-011 | Check exact balance and lifetime-total deltas. Link one completed request to one stored transaction. |
| Provider identity | PROV-012, PROV-016, PROV-018 | Credit the authenticated stable provider principal. Do not use socket IDs or display names as billing identity. |
| Ownership and privacy | PRIV-001, PRIV-003, PRIV-009, AUTH-007 | Deny cross-owner reads and writes. Do not expose tokens, request content, or private billing identifiers. |
| Routing and input | ROUTE-001, ROUTE-010, ROUTE-013 | Honor trust and explicit model IDs. Fail closed when no provider is eligible. |
| Test isolation | OPS-006 | Keep SQLite, accounts, and credentials local to the test. Never use production data. |

Test duplicate completion, retry, reconnect, and failure boundaries for changes that affect them.
Check that one operation does not charge twice or credit the wrong principal.
Do not assume that an unimplemented requirement already passes.
For example, BILL-007 still describes incomplete partial-stream billing.
Follow the approved requirement status and its linked issue.

## Compositional verification

A unit test can pass while the full request path fails.
For changes to billing, routing, authentication, or provider identity, verify the affected path:

`consumer HTTP request → coordinator auth and routing → authenticated OCIP provider over WebSocket → inference completion → SQLite transaction → consumer debit + provider credit + fee → owner views`

Before merging a change, identify its upstream callers and downstream effects.
Test affected API or OCIP contracts and persistent data changes.
Run a related integration or E2E check when a boundary or critical invariant changes.
Cover both successful and denied paths where authorization is involved.
For streaming changes, verify valid SSE framing and relevant failure behavior.
Do not claim whole-system correctness from a unit-only pass.

The current `tests/test_mock_provider_e2e.py` has a real local HTTP and WebSocket path.
It verifies a consumer balance decrease, but not the full ledger split.
Issue #212 defines the first stronger deterministic settlement regression.
Do not bypass the path with a direct `Store.charge_request` call in that E2E test.

## Deterministic test environment

- Use the autouse `tests/conftest.py` SQLite isolation fixture.
- Use temporary files and test-only credentials. Clean them after each test.
- Bind local coordinator ports to loopback. Use an isolated ephemeral port.
- Use authenticated mock providers and explicit test model IDs.
- Set predictable mock output, token counts, and prices.
- Wait for asynchronous billing with a bounded condition check. Do not use a fixed sleep as proof.
- Check transaction counts and IDs to detect duplicates.
- Keep failure messages free of prompts, API keys, provider tokens, and personal data.
- Do not require external GitHub calls, GGUF files, GPUs, production services, or real accounts in PR CI.
- Restore changed environment variables and stop local test servers during cleanup.

Do not enable `tests/local_e2e_test.py` or `tests/test_integration.py` unchanged.
Those legacy scripts are excluded from CI and use obsolete product assumptions.
New tests must use explicit model IDs, current GitHub/session or API-key auth, and current L0 disclosures.
Open providers can read plaintext requests. Do not assert otherwise.

## Existing CI gates

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
It has `python`, `web`, `requirements`, `deploy-images`, and `infra` jobs.
Keep deterministic Python E2E tests in the existing `python` job.
The existing `requirements` job checks requirement-to-test references.
Do not add a second CI workflow for the same tests.

Run affected tests before the full suite when possible:

```bash
pip install -e ".[dev]"
pytest tests/test_mock_provider_e2e.py -q
pytest tests -q --ignore=tests/load_test.py --ignore=tests/local_e2e_test.py \
  --ignore=tests/test_integration.py --ignore=tests/test_preferences.py \
  --deselect tests/test_openai_sdk.py
python scripts/check_requirements.py
cd web && npm ci && npm run build
```

Run the relevant `node src/lib/*.test.mjs` scripts for a web change.
The CI `web` job runs the complete configured Node script list.
Use the CI job results as the final source for PR gate status.
Never report a test as passed unless it ran and passed.

Long-running browser, stress, concurrency, and fault-injection checks can run in staging or a planned schedule.
A post-deployment canary requires separate operator approval.
An automated PR must never start a production canary.

## Test evidence in issues and pull requests

For each change, record:

```text
Issue: #...                    PR: #...
Requirement IDs: ...
Behavior or defect: ...
Red: test name, command, failure reason (or justified exception)
Green: test name, command, result
Regression coverage: unit / component / contract / integration / property / E2E
Affected paths: ...
CI: job, run URL, commit SHA, status
Not verified: browser / physical provider / staging / production / other
Release status: source only / merged / deployed / real hardware / independent acceptance
```

Use sanitized evidence and link the same issue from the PR.
Update the issue after meaningful tests or acceptance checks.
Separate tests that ran from checks that are only planned.
A green mock-provider E2E test does not prove production settlement.
It does not prove that an independent provider can install and serve.

## Next implementation: #212

Implement #212 in a separate PR after this policy review.
Start with a failing local E2E test that uses isolated SQLite, real loopback HTTP, and an authenticated WebSocket mock provider.
Assert one settled transaction and exact integer consumer debit, stable provider credit, and platform fee.
Check private owner earnings and cross-owner denial.
Then extend coverage for streaming, reconnect, duplicate completion, and failure paths.
Keep existing tests and CI. Link the evidence to #212, #59, and #109.

No test policy authorizes a production change.
Do not merge, deploy, restart services, change production configuration, rotate credentials, or modify production data without explicit approval.
