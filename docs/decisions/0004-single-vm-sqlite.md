# 0004: One VM and SQLite for alpha

- Status: Accepted
- Date: 2026-10-01
- Principles: P8

## Context

The coordinator keeps provider WebSocket connections and the request queue in memory. More than one coordinator would need shared state for these. The expected alpha load is thousands of users at chat request rates.

## Decision

Run one coordinator on one VM. Use SQLite in WAL mode. Back it up continuously with Litestream. Serve the web UI and TLS with Caddy on the same VM.

## Consequences

- Simple to operate and cheap.
- One VM is a single point of failure. Litestream reduces data loss; it does not give high availability.
- Move to Postgres and more than one coordinator only when a measured limit requires it. See #71 for the stages and the trigger metrics.
