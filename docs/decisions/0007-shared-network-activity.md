# 0007: Shared network activity

Date: 2026-11-06
Status: Accepted by the project owner in the shared network activity discussion.

## Context

The account-scoped globe looks empty to a new account.
The owner wants everyone to see the same exchange activity without user-level identifiers.
The owner approved public countries, served models, outcomes, token counts, latency, cost, and minute-rounded times.
This changes P2's former restriction against any single-request public data.

## Decision

Add an explicit public projection at `/v1/exchange/activity/network`.
Give anonymous visitors, members, and admins the same response.
Show the latest 30 recorded outcomes and a separate latest-30-completions window.
Use the existing seven-day bounded operational history.
Do not apply the legacy daily country thresholds to this projection.
Keep the legacy daily aggregate endpoint compatible.

Publish only the fields listed in GEO-003.
Use settled served-model metadata, rather than arbitrary requested model strings.
Do not publish original request IDs, hashes of those IDs, account IDs, email, provider identity, IPs, credentials, exact timestamps, reason text, scoring, prompts, or responses.
Keep detailed traces, balances, billing history, and signup analytics under their existing access rules.
The geography exclusion header hides countries but does not remove non-geographic activity.

## Consequences

New accounts see network activity before they send a request.
Public records cannot be opened as private trace links.
Minute rounding and identifier removal reduce direct correlation.
They do not guarantee anonymity.
A distinctive country and model on a small network can still reveal activity to someone with outside knowledge.
The application must describe this as shared activity, not anonymous activity.
