# Paid-path data model

This ERD describes the PostgreSQL schema (decision 0008) in [paid-path architecture §6.1](paid-path-architecture.md#61-units-and-tables) and the recovery tables in [§8.3](paid-path-architecture.md#83-ledger-outbox-and-inbox).

`PK` is a primary key and `FK` is an intended foreign key. Each relationship shows the proposed logical cardinality. The architecture gives a subset of the SQL constraints, so the migration should confirm FK enforcement and nullability. Amounts ending in `_micro` are integer micro-USD.

```mermaid
erDiagram
    direction TB

    accounts ||..o{ funding_orders : places
    accounts ||..o{ funding_lots : owns
    accounts ||..o{ paid_requests : submits
    funding_orders |o..o| funding_lots : yields
    funding_orders |o..o{ rail_events : correlates
    paid_requests ||--o{ attempts : tries
    paid_requests ||--o{ hold_allocations : reserves
    funding_lots ||--o{ hold_allocations : funds
    funding_lots ||..o{ refunds : refunds_from
    attempts ||--o| reconciliation_items : may_need_review
    ledger_transactions ||--|{ postings : has
    ledger_accounts ||--o{ postings : records
    funding_lots |o..o{ postings : attributes
    paid_requests |o..o| ledger_transactions : charged_by
    refunds |o..o| ledger_transactions : posted_by

    accounts {
        id account_id PK
    }
    funding_orders {
        id order_id PK
        id account_id FK
        id rail_id
        integer amount_micro
        integer rail_amount
        code currency
        rate rate
        state status
        timestamp expires_at
    }
    funding_lots {
        id lot_id PK
        id account_id FK
        id order_id FK
        id rail_id
        id rail_ref
        enum kind
        integer amount_micro
        integer remaining_micro
    }
    paid_requests {
        id request_id PK
        id account_id FK
        state phase
        enum location_policy
        id route_id
        integer active_attempt
        snapshot quote
        integer hold_micro
        integer charge_micro
        string idempotency_key
    }
    attempts {
        id request_id PK, FK
        integer attempt_no PK
        id route_id
        enum location
        id session_id
        state dispatch
        timestamp sent_at
        state result
        integer upstream_cost_micro
    }
    hold_allocations {
        id request_id PK, FK
        id lot_id PK, FK
        integer amount_micro
    }
    ledger_accounts {
        id ledger_account_id PK
        enum mode
        enum owner_kind
        id owner_id
        enum kind
    }
    ledger_transactions {
        id txn_id PK
        enum mode
        enum kind
        string idempotency_key
        id request_id FK
        id refund_id FK
        id order_id FK
        timestamp at
    }
    postings {
        id posting_id PK
        id txn_id FK
        id ledger_account_id FK
        id lot_id FK
        integer amount_micro
    }
    refunds {
        id refund_id PK
        id account_id FK
        id lot_id FK
        id rail_id
        id rail_ref
        state phase
        integer amount_micro
        string destination
    }
    rail_events {
        id rail_id PK
        id rail_event_id PK
        id order_id
        id rail_ref
        enum type
        timestamp received_at
        state status
    }
    rail_cursors {
        id rail_id PK
        cursor cursor
    }
    reconciliation_items {
        id request_id PK, FK
        integer attempt_no PK, FK
        string reason
        state status
    }
    outbox {
        id id PK
        enum kind
        string key
        payload payload
        state status
        integer attempts
        timestamp next_at
    }
```

### How to read the diagram

- **Hold.** A request can reserve funds across several lots. The pair `(request_id, lot_id)` identifies one allocation. The reservation transaction verifies that the request and lot belong to the same account and checks available funds before inserting allocations.
- **Attempt.** The pair `(request_id, attempt_no)` identifies an attempt. A reconciliation item refers to that whole pair. The request's `active_attempt` refers to an attempt number within that request.
- **Charge and refund.** Partial unique indexes on `ledger_transactions(request_id)` for kind `charge` and `ledger_transactions(refund_id)` for kind `refund` allow one of each. Every table has a `mode` column, and each foreign key includes it (decision 0010).
- **Deduplication.** Requests use `UNIQUE(account_id, idempotency_key)`. Funding lots and refunds each use `UNIQUE(rail_id, rail_ref)` within their own table. Incoming rail events use `(rail_id, rail_event_id)` as their primary key.
- **Recovery.** `rail_cursors` and `outbox` appear alongside the related tables. Their polling, replay, and work-queue relationships operate through rail IDs or command and payload data. The architecture specifies no direct foreign keys from those records to requests or refunds.

### One paid request

1. A customer has 30 micro-USD in a sponsored lot and 100 micro-USD in a paid lot. A 100 micro-USD hold creates two allocations, 30 from the sponsored lot and 70 from the paid lot.
2. IE records a provider attempt before dispatch. A definite rejection can lead to a second attempt under the same request ID.
3. If the final charge is 40 micro-USD, IE consumes 30 from the sponsored lot and 10 from the paid lot under the proposed sponsored-first policy. Settlement posts the charge, ends the hold, and leaves 90 micro-USD available in the paid lot.

The charge is one `ledger_transactions` row of kind `charge` with three postings: −30 on the sponsored lot, −10 on the paid lot and +40 to platform revenue. The postings sum to zero. The partial unique index on `ledger_transactions(request_id) WHERE kind = 'charge'` keeps one charge per request (decision 0009).

Live offers and provider connections are described in [§5.1](paid-path-architecture.md#51-one-offer-type). The request row retains the selected route and quote for billing and audit.
