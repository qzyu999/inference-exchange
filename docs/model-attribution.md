# Model attribution contract (#134)

The request `model` can be an exact ID or the `default` routing alias,
which is **never** an actual model.

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

**History:** migrations only add nullable columns. Previously billed rows
are never backfilled, even if `model` names a concrete model. A NULL
`requested_model` reads as the original `model`, while `served_model`
remains unknown. Billing groups on `served_model` only, with clear unknown
labels. Charge amounts, provider principals, credentials and balances are
unmodified.

**Deployment:** an updated coordinator can accept older OCIP completion
messages. Agent upgrades are optional; production coordinator migration
must be separately approved after WAL-safe online backup and isolated
migration rehearsal. Rollback application code; do not drop additive columns.
