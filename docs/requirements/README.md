# Requirements

Requirements are the rules that the code must obey. They come from the [principles](../principles.md). They are written for Public Alpha.

## Format

Each requirement has this format:

```markdown
### AREA-NNN: Short title

MUST: One rule. Write it so that a test can show if it is true or false.

- Principle: P1
- Status: implemented
- Verified by: tests/test_file.py::test_name
```

## Words

- **MUST**: Mandatory.
- **MUST NOT**: Prohibited.
- **SHOULD**: Recommended. If you do not obey it, write the reason in the pull request.

## Status values

| Status | Meaning |
|---|---|
| `implemented` | The code obeys the rule. At least one test in **Verified by** shows this. |
| `partial` | The code obeys part of the rule. **Issue** shows the remaining work. |
| `not-implemented` | The code does not obey the rule yet. **Issue** shows the work. |

## Rules for change

1. Only the project owner approves a change to a requirement.
2. Change the requirement before the code changes, or in the same pull request.
3. Do not change an ID. Do not use an old ID again. To remove a requirement, set its status to `withdrawn` and give the reason.
4. CI runs `scripts/check_requirements.py`. The check fails if an `implemented` requirement has no test, or if a test in **Verified by** does not exist.

## Areas

| Area | File | Contents |
|---|---|---|
| AUTH | [auth.md](auth.md) | Sign-in, sessions, API keys, admin role |
| PRIV | [privacy.md](privacy.md) | Traces, events, public data, trust labels |
| BILL | [billing.md](billing.md) | Charges, balances, fees |
| ROUTE | [routing.md](routing.md) | Provider selection, trust filter, queue |
| PROV | [providers.md](providers.md) | Provider admission, connection, trust |
| OPS | [ops.md](ops.md) | Deployment, configuration, backups, metrics |
