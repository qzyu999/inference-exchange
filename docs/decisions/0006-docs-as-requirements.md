# 0006: Requirements in docs, checked by CI

- Status: Accepted
- Date: 2026-10-01
- Principles: P9

## Context

The project had 37 design documents. Many overlapped, and some were out of date. No document said which source was correct.

## Decision

- `docs/principles.md` and `docs/requirements/` are the normative source.
- Each requirement has an ID, a status, and a test or an issue.
- `scripts/check_requirements.py` runs in CI and fails if a requirement and the tests disagree.
- Old documents are in `docs/archive/` and are not normative.
- The web app shows the docs at `/docs`, built from the same commit as the code.
- Write docs in a form of ASD-STE100 Simplified Technical English.

## Consequences

- To change behaviour, change the requirement first or in the same pull request.
- The project owner approves requirement changes.
- The docs in the app always match the deployed code.
