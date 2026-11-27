# 0009: Double-entry postings are the money record

- Status: Accepted
- Date: 2026-11-26
- Principles: P7

## Context

The first paid-path design kept a journal and also wrote balance tables in the same transaction. That is two records of the same money. It also could not record one charge that draws on several funding lots, because a charge entry had one lot.

## Decision

Money is recorded only as immutable double-entry postings.

- `ledger_transactions` has one row for each business event: funding, charge, refund, dispute or correction. Its idempotency key is unique.
- `postings` has the lines of one transaction. Each line names a ledger account, an optional funding lot, a signed integer amount in micro-USD and a mode. The lines of a transaction sum to zero. A deferred constraint trigger checks this at commit.
- No posting is updated or deleted. A correction is a new transaction.
- A lot balance and an account balance are sums of postings. A cached balance column is allowed only if it changes in the same transaction as its postings, has `CHECK (>= 0)` where the balance cannot be negative, and a scheduled job compares it with the sum.
- A charge that draws on several lots is one transaction with one line per lot.
- Platform revenue is never a stored balance, so charges do not contend on one row.

## Consequences

- Conservation is a database rule, not only a test.
- Per-lot attribution, refundable credit and audit trails come from one query shape.
- The journal and its rebuild check in the first design are not needed.
- Reports read postings. A large postings table is partitioned by time (#331).
