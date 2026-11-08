# Exchange price catalog

### CATALOG-001: All-model catalog and exact comparison identity

MUST: Show the published external catalog and live admitted, non-quarantined IE offers. Filter models by IE availability without removing external comparison offers. Join source IDs through explicit exact aliases. Keep unmapped models separate. Keep routes distinct. Preserve zero and unknown rates. Show stale observations and reject them from headline savings. Require matching known quantization and context for headline percentages. Show input, cache-read, and output separately.

- Principle: P2, P3, P5, P8
- Status: implemented
- Verified by: tests/test_ticker_catalog.py, web/src/lib/catalog.test.mjs, web/src/lib/exchange-filter-recovery.test.mjs
- Issue: #269

### CATALOG-002: Durable versioned market data synchronization

MUST: Read the manifest and payload from one immutable Git commit. Validate checksum, schema, unique identities, finite nonnegative decimal rates, timestamps, and bounded history before replacement. Persist a validated newer generation before making it visible. Retain last-good data after synchronization or write failure. Load valid persisted data at startup. Never receive consumer upstream API keys. Expose public read-only catalog and per-model observed history routes.

- Principle: P2, P3, P4, P5, P6, P8
- Status: implemented
- Verified by: tests/test_ticker_catalog.py, tests/test_route_inventory.py
- Issue: #269
