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
cd web && npm ci && npm run build && node src/lib/docs.test.mjs
```

Use the mock provider when you do not have a model: `python -m inference_exchange.provider --mock --trust hardened`.
