# Country activity

### GEO-001: Publish only coarse completed country activity

MUST: Optional geography collection is disabled by default. Enable it only with an explicit flag and an ingress secret of at least 32 characters. The trusted edge overwrites the secret marker and supplies `CF-IPCountry`. Reject missing or incorrect markers and non-ISO country codes. Honor the geography exclusion header. This applies to the OpenAI-compatible HTTP endpoint and provider WebSocket registration. No IP lookup service or browser location API is used.

MUST: Capture only a provider country and caller country for actual completed inference after settlement succeeds. Capture the actual selected provider, including retries and queued requests. Do not add geography to individual traces, provider listings, public events, or billing records. Geography failures must not stop billing or response delivery.

MUST: The public read-only `/v1/exchange/country-activity` endpoint releases only the previous UTC day's country pairs with at least five completed requests from at least three distinct consumer accounts. Publish count bands, not exact counts, identities, models, request IDs, or request timestamps. The anonymous account does not qualify. Release no current-day routes. These are suppression safeguards, not a formal anonymity guarantee.

MUST: Keep only bounded process-memory counters for the current and previous UTC days. Use daily salted keyed hashes for deduplication and distinct-account thresholds. Do not retain raw IPs or raw account/request identifiers for this feature. Purge older buckets at least once per minute while the coordinator runs. Restarting the coordinator clears this feature's history.

MUST: Overview shows an Earth visualization with historical country routes, honest disabled/error/sparse states, manual rotation, and reduced-motion support. An optional example is clearly labeled as an illustration. It does not mix with actual activity. Location labels describe approximate API connection origins, not users' residences. The feature does not affect routing or trust policy.

- Principle: P2, P3, P6, P8
- Status: implemented
- Verified by: tests/test_country_activity.py, tests/test_route_inventory.py, web/src/lib/globe.test.mjs
