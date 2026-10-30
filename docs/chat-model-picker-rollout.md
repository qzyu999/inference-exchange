# Chat searchable model picker rollout (#191)

## Goal and model identity

Chat only lists actual runnable model IDs returned by `GET /v1/models`.
It never imports reference-only model lists from Exchange.

The `default` API request alias remains valid for SDK consumers.
The Chat UI does not send it. Billing history may still contain old `default`
rows. Do not rename historical rows without serving-model evidence (#134).

## Behavior

- One online model: automatically select it, so a new user only needs to
  acknowledge the applicable trust floor before sending a harmless prompt.
- Many online models: search by case-insensitive words, keyboard or mouse.
- An explicit `?model=...` URL: keep the exact requested model. If the provider
  disappears or the URL is stale, show an error. Do not pick another model silently.
- Offline/no-model/API error: block Send and show a meaningful explanation.
- The L2 default and manual L0/Open decision remain unchanged.

## Checks

GitHub CI runs `npm run build`, the existing Web test suite,
`chat-models.test.mjs`, and `chat-model-picker.test.mjs`.
Source tests are not a substitute for testing the rendered combobox in a browser.

## MBP A / Mac mini deployment acceptance

1. Confirm PR tests pass and the exact merged commit.
2. From a **separate worktree** on MBP A, run `npm ci && npm run build`.
3. Confirm the currently served Caddy index hash against the live `web/dist`.
4. Save a timestamped backup of the existing static `web/dist`.
5. Copy versioned assets into the active static directory without deleting old
   assets; then atomically switch `index.html` as in the previously validated
   PR #190 procedure.
6. Compare public HTML hash with the new build. Confirm `/health` remains OK
   and the original M6 provider is online. Do not restart the coordinator,
   edit SQLite or touch Mac mini credentials.
7. Browser: test one model, keyboard search, mobile overlay and focus,
   stale `?model=bogus` link, L0 consent, a harmless streamed request,
   real model identity on **new** billing transactions, and offline handling.
8. Keep prior frontend backup for rollback; revert only static UI assets if
   the browser experience fails.

**Separate issue:** #134 will repair durable requested/served identity and the
interpretation of older billing rows. It needs an independent coordinator
schema and data-safety review and is not part of this frontend-only PR.
