# Shared model search: Exchange + Chat (#193)

Both pages now render the **same** `ModelSearch` component. The search input,
keyboard interactions, list rows, focus and mobile behavior are one implementation.

- **Exchange** passes its broad discovery list from `/v1/exchange/market`
  and reference-price families, preserving the existing capability/size/price/family
  filters, result order and detailed comparison views. Rows distinguish
  `Reference only` from `On IE`.
- **Chat** passes only the real IDs from `GET /v1/models`, via a small
  `ChatModelPicker` adapter. It still refuses unavailable IDs and the
  request-side `default` alias. A reference-only model may be discovered
  in Exchange but cannot be executed from Chat.
- Both use `web/src/lib/model-search.js` for case-insensitive token search.
  This removes two independent search experiences without merging the
  underlying discovery and inference data sources.

## Tests and safe deployment

CI: `npm run build` + existing Web tests + `node src/lib/model-search.test.mjs`.
Check the rendered result on mobile, desktop and keyboard; source-level tests
alone are insufficient. Exchange must retain all rich filters and model
comparison details. Chat must preserve explicit L0 consent, session isolation,
and actual online model IDs.

On MBP A, make a **new detached worktree at the exact merged commit**,
build `web/dist`, preserve a timestamped backup of the running static files,
copy new hashed assets, and atomically swap `index.html`. Verify local/public
index hashes and `/health`/models. Do **not** restart Caddy, the coordinator,
the Mac mini agent or inference server; do not touch SQLite or credentials.
Rollback only the static frontend from the new saved backup.

Historical `default` billing is a different issue (#134).
