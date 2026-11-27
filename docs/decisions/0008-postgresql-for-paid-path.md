# 0008: PostgreSQL for the coordinator database

- Status: Accepted
- Date: 2026-11-26
- Principles: P7, P8
- Replaces: [0004](0004-single-vm-sqlite.md) for the database. The rest of 0004 stays in force until a later record changes it.

## Context

The paid path takes customer money. It must not lose a committed payment, charge or refund. It must also grow from one machine to several API replicas without a change of database. SQLite allows one writer per file and has no standby. Litestream can lose about one second of committed writes. A later move of a live money ledger to another database is a high-risk migration.

## Decision

Use PostgreSQL for all coordinator data: accounts, keys, the ledger, requests, payments and work queues. Do not split money and accounts across two databases.

Grow in stages (#331):

| Stage | Hosting | Use |
|---|---|---|
| 0 | PostgreSQL on the alpha host, with a continuous WAL archive to off-site storage | Invite-only alpha with low caps |
| 1 | Managed PostgreSQL with a standby in a second zone and point-in-time restore | Public beta with customer funds |
| 2 and later | Larger instance, read replicas, partitions, then scale out | When a measured signal in #331 requires it |

Development and CI use PostgreSQL too. The code supports one database, not two.

## Consequences

- The application reads one database URL and pool settings from configuration. A stage change is a configuration change.
- Money commands are short transactions that lock only one account's rows. Workers claim rows with `FOR UPDATE SKIP LOCKED`. More than one API replica can run.
- Money reads go to the primary. No rule depends on replica lag.
- A standby is not a backup. Point-in-time restore stays on in every stage after 0.
- The existing SQLite `Store` needs a verified data migration. The migration reconciles row counts and balances before and after.
- Stage 0 can lose the writes since the last archived WAL segment. The alpha caps limit that exposure. Stage 1 is required before customer funds above the alpha caps.
