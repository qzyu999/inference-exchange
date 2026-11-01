# Model attribution contract (#134)

New public chat requests must name an exact, nonblank model ID.
The old `default` routing alias is **not** accepted in new chat requests.
It may still appear in historical transaction data, and it is never an actual model.

**Backward compatibility:** existing SQLite `transactions.model`, history
JSON `model`, and OpenAI-compatible response/SSE `model` retain their
requested-model meaning. New records add `requested_model` and nullable
`served_model`; public SDK responses include `ocip_requested_model` and
nullable `ocip_served_model`. OpenAI SDK ignores these optional extensions.

**Evidence:** the coordinator accepts `InferenceDone.served_model` when it is
advertised by that provider and agrees with any exact model request. For
older single-model providers, the one registered eligible model suffices.
An unconfirmed multi-model provider is **unknown**, never `models[0]`.
Provider identity is self-reported, not cryptographically attested.

**History:** automatic migrations only add nullable columns and never
backfill prior transactions. A separate owner-approved, reviewed, audited
one-time correction may attribute eligible historical transactions without
changing their original `transactions.model` values. A NULL
`requested_model` reads as the original `model`; a NULL `served_model`
remains unknown. Billing groups on `served_model` only, with clear unknown
labels. Charge amounts, provider principals, credentials and balances are
unmodified.

**Deployment:** an updated coordinator can accept older OCIP completion
messages. Agent upgrades are optional; production coordinator migration
must be separately approved after WAL-safe online backup and isolated
migration rehearsal. Rollback application code; do not drop additive columns.
