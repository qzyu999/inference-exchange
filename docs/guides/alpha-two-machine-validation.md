# Private alpha: two-machine verification and release gate

**Status:** Operator checklist. Not yet executed on MBP A or the existing Mac mini.

Use this procedure **after** the CI-green PRs are merged. Do not modify the
live alpha until the owner approves the deployment and records a backup.
Do not use this guide as proof of L1/L2 trust or real-money settlement.

## Stage A — Coordinator database rehearsal (no downtime, read only)

1. On the coordinator Mac, confirm the checked-out repository revision.
2. Find the currently configured SQLite path. Do not guess it or initialize
   a new database by accident. The coordinator may set \`IE_DB_PATH\`.
3. Record the existing provider's **public node ID** and stable
   **billing principal** from operator data. Do **not** enter the provider
   token into a command, file, screenshot or issue.
4. Run the read-only snapshot rehearsal on the exact existing SQLite file:

\`\`\`bash
python scripts/alpha_sqlite_preflight.py \
  --db "$IE_DB_PATH" \
  --principal "$IE_LEGACY_PROVIDER_PRINCIPAL" \
  --node-id "$IE_LEGACY_NODE_ID"
\`\`\`

Set the three environment variables in your private terminal before
running the command. They are placeholders here, not source-controlled
values. The principal and node ID are metadata, **not** the \`pt-ie-\` secret.

This command opens the source as SQLite \`mode=ro\`. It creates a
disposable copy with the SQLite backup API, runs the latest Store schema
migration on the **copy**, and compares nine historical tables. It also
checks SQLite integrity, referential integrity, the existing provider
credential binding and exact simulated earnings reconciliation.

It does **not** restart the coordinator, rotate credentials or edit the
source SQLite database. If the preflight fails, **stop**. Investigate
the copied-schema issue before any deployment.

## Stage B — Protected change window on MBP A

These steps require a separate explicit operator decision. The rehearsal
does not replace an actual durable backup.

1. Record current coordinator commit, process/service configuration,
   public health, owner node view and simulated ledger summary.
2. Record exact existing provider node ID and principal. Do not disclose
   the credential.
3. Stop **only** the coordinator process at a planned point, then create
   a durable SQLite backup with \`sqlite3.Connection.backup()\` or the
   SQLite online backup command. Do not copy only the \`.db\` file while
   WAL writers are active.
4. Retain a rollback copy outside the repository with restricted access.
   Keep \`-wal\`/\`-shm\` considerations and file ownership in mind.
5. Deploy the reviewed coordinator and web commit. Keep
   \`IE_PROVIDER_SELF_ENROLL_ENABLED=0\` and existing Cloudflare
   Access policy unchanged.
6. Verify the coordinator starts with the expected SQLite path. Check
   the original node owner/principal, unchanged historical ledger, and
   server-side account isolation.
7. Verify \`/settings\`, \`/dashboard\` and \`/provide\` as their
   intended GitHub-linked users. The disabled enrollment API must still
   return 503; do not issue a new credential yet.

**Rollback trigger:** An unexpected migration change, startup exception,
changed legacy principal or token hash, ledger mismatch, privacy leak,
failure to reconnect, or incorrect Access gate. Stop rollout. Restore the
backed-up coordinator data with the original code and operator procedure.
Never restore a stale database over new accepted transactions without
explicitly reconciling those transactions first.

## Stage C — Existing Mac mini provider regression

On the existing independent Mac mini:

1. Keep the original provider credential and billing principal in place.
2. Do not re-enroll the existing node or regenerate its token.
3. Verify the OCIP agent connects to the coordinator using an outbound
   authenticated WebSocket. Do not put the credential in the URL.
4. Verify its GGUF model loads and returns a real inference response.
5. On the existing owner account, verify node status, request count,
   original ledger balance and exact provider earnings.
6. Confirm the charge conservation rule in integer micro-USD:
   consumer debit = provider earnings + platform fee.
7. Test coordinator restart and provider reconnect in a planned window.
   Compare the original provider node/principal/ledger before and after.

## Stage D — A different provider account and fresh Mac

**Do not enable public enrollment for this stage by default.** Use a
controlled test window after A–C pass and after owner approval. Keep
Cloudflare signup and operator Access protections as reviewed.

1. Use a **different GitHub-linked account**, not the owner of the
   existing Mac mini.
2. Use a qualified Apple Silicon Mac with a recorded macOS and GGUF/
   llama.cpp build. If the existing Mac mini must also be the test
   machine, use a separate installation and token without rotating
   its original provider identity.
3. Enable the feature flag only for the controlled acceptance window.
   Enrollment is global when enabled; do not confuse a flag with a
   per-account allowlist or Access restriction.
4. Enroll from \`/provide\`. Save the one-time credential privately.
5. Connect using the current OCIP agent and header-authenticated
   outbound \`wss://\`. Confirm the new node and ledger principal are
   separate from the existing M6.
6. Exercise a real prompt, connection failure, invalid registration,
   model unavailable, unsupported trust, rate and active-node caps.
7. Verify account A cannot see account B's nodes, earnings or credential
   metadata or revoke B's credential.
8. Revoke the new self-service credential. Verify its live connections
   disconnect, reconnect is denied, and the historical ledger remains.
9. Disable enrollment again and record test evidence in #160.
10. Update the versioned setup preview only after its exact hardware,
    macOS, model hash and agent build pass the independent-Mac test.

## Release decision

The CI suite proves source behavior in isolated tests. It does **not**
prove the live coordinator migration, actual device performance, real
inference, network reliability or Cloudflare ingress configuration.

Do not invite external providers until the owner confirms: durable backup,
MBP A migration, old M6 continuity, independent GitHub-user enrollment,
real request/ledger conservation, revocation, CSRF/account isolation,
and safe rollback. Keep simulation labels; there are no payouts.
