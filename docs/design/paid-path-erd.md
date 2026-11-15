# Paid-path data model

This ERD describes the proposed SQLite schema in [paid-path architecture §6.1](paid-path-architecture.md#61-units-and-tables) and the recovery tables in [§8.3](paid-path-architecture.md#83-journal-and-outbox).

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
    paid_requests |o..o{ ledger_entries : posts
    funding_lots |o..o{ ledger_entries : attributes
    refunds |o..o{ ledger_entries : posts

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
    ledger_entries {
        id entry_id PK
        id account_id FK
        id lot_id FK
        id request_id FK
        id refund_id FK
        enum kind
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
    journal {
        integer seq PK
        timestamp at
        string command
        string key
        payload payload
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
- **Charge and refund.** The architecture specifies partial unique indexes on `ledger_entries(request_id)` for charge entries and `ledger_entries(refund_id)` for refund entries. Those restrictions apply to the matching entry kind. `ledger_entries.account_id` and `refunds.account_id` also refer to accounts.
- **Deduplication.** Requests use `UNIQUE(account_id, idempotency_key)`. Funding lots and refunds each use `UNIQUE(rail_id, rail_ref)` within their own table. Incoming rail events use `(rail_id, rail_event_id)` as their primary key.
- **Recovery.** `rail_cursors`, `journal`, and `outbox` appear alongside the related tables. Their polling, replay, and work-queue relationships operate through rail IDs or command and payload data. The architecture specifies no direct foreign keys from those records to requests or refunds.

### One paid request

1. A customer has 30 micro-USD in a sponsored lot and 100 micro-USD in a paid lot. A 100 micro-USD hold creates two allocations, 30 from the sponsored lot and 70 from the paid lot.
2. IE records a provider attempt before dispatch. A definite rejection can lead to a second attempt under the same request ID.
3. If the final charge is 40 micro-USD, IE consumes 30 from the sponsored lot and 10 from the paid lot under the proposed sponsored-first policy. Settlement posts the charge, ends the hold, and leaves 90 micro-USD available in the paid lot.

The settlement example exposes a schema question for implementation. A single charge entry has one `lot_id`, while a charge can consume multiple lots. The migration needs to specify how the ledger or journal records the contribution from each lot while preserving one charge per request.

Live offers and provider connections are described in [§5.1](paid-path-architecture.md#51-one-offer-type). The request row retains the selected route and quote for billing and audit.
