# Exchange price catalog

### CATALOG-001: All-model catalog and exact comparison identity

MUST: Show the published external catalog and live admitted, non-quarantined IE offers. Filter models by IE availability without removing external comparison offers. Join source IDs through explicit exact aliases. Keep unmapped models separate. Keep routes distinct. Preserve zero and unknown rates. Show stale observations and reject them from headline savings. Require matching known quantization and context for headline percentages. Show input, cache-read, and output separately.

An exact comparison alias must not verify an artifact hash.
An exact comparison alias must not establish runtime identity.
An exact comparison alias must not make different quantizations equivalent.

- Principle: P2, P3, P5, P8
- Status: implemented
- Verified by: tests/test_ticker_catalog.py, web/src/lib/catalog.test.mjs, web/src/lib/exchange-filter-recovery.test.mjs
- Issue: #269

### CATALOG-003: Exact comparison identity and source labels

MUST: Use a catalog model ID as the comparison identity.
Resolve local models through exact source IDs or reviewed aliases.
Use the same resolver for offers and reference prices.
Do not join models through parsed name facets.
Keep each unmapped local model in a separate provider-qualified IE entry.
Keep facets typed and unknown values distinct.
Use source labels for display.
Build reviewed family labels from family fields in the published catalog.
Refresh those labels with each catalog generation.
Normalize family labels for search.
Permit reported repositories to select comparison rows for browsing.
Label reported identities and reviewed aliases separately.
Show artifact verification as a separate state.

- Principle: P2, P3, P8, P9
- Status: implemented
- Verified by: tests/test_comparison_identity.py, tests/test_model_facets.py, tests/test_reference_pricing.py, web/src/lib/catalog.test.mjs, web/src/lib/model-size.test.mjs
- Issue: #279

### CATALOG-002: Durable versioned market data synchronization

MUST: Read the manifest and payload from one immutable Git commit. Validate checksum, schema, unique identities, finite nonnegative decimal rates, timestamps, and bounded history before replacement. Persist a validated newer generation before making it visible. Retain last-good data after synchronization or write failure. Load valid persisted data at startup. Never receive consumer upstream API keys. Expose public read-only catalog and per-model observed history routes.

- Principle: P2, P3, P4, P5, P6, P8
- Status: implemented
- Verified by: tests/test_ticker_catalog.py, tests/test_route_inventory.py
- Issue: #269

### CATALOG-004: Raw-source comparison history

MUST: Keep historical observations under their raw source IDs.
Use the exact comparison resolver for historical groups.
Return the current catalog generation with history.
Reject a legacy key that selects multiple model identities.
Preserve a separate series for each raw source and model.
Keep observations accessible after a facet parser change.
Keep history reads within the retention period.
Do not rewrite observations during index migration.

- Principle: P2, P3, P8, P9
- Status: implemented
- Verified by: tests/test_reference_price_history.py, tests/test_store_read_consistency.py
- Issue: #279
