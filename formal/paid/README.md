# Paid path model

This model checks the proposed wallet, request lifecycle, capacity and refund rules in
[the paid path design](https://github.com/qzyu999/inference-exchange/issues/297#issuecomment-6870406935). It has
supply from two directions: a node behind the IE agent (any runtime, home or
data center) and a hosted vendor.

Run it with TLC 1.8.0 and Java 17 or newer:

```
python formal/paid/check.py /path/to/tla2tools.jar
```

The script runs the model once for each interrupted-stream policy
(`BillInterrupted`). Then it runs each negative control in a temporary
directory. A control removes one guard. TLC must find a counterexample for the
named property. If a control passes, the property does not test that guard.
CI pins the TLC release and its SHA-256 digest.

## State

One step is one committed SQLite transaction or one external event. A stale,
duplicate or foreign event whose guard fails has no effect.

| Variable | Meaning |
|---|---|
| `paid`, `sponsored` | Wallet balances in abstract micro-USD units. |
| `credited` | The one processor payment was credited. |
| `req[r]` | Phase, route, attempt, sponsored and paid holds, debits, winner. |
| `sent` | Each attempt that was sent, with the route that received it. |
| `slots` | Capacity in use on each route. |
| `local` | The node's offer state: available, draining, paused or offline. |
| `uncertain`, `resolved` | Hosted attempts with an open or a resolved vendor cost. |
| `rejected` | Attempts that the route definitely rejected before output. |
| `refund` | The state of one refund in SQLite. |
| `outbox` | The refund's outbox row: none, queued or done. It survives a restart. |
| `procState`, `procMoved` | What the processor did for the refund's idempotency key, and how many times money moved. |
| `earned`, `revenue` | Community provider earnings and platform revenue. |
| `absorbed` | Reported usage above the authorized hold that IE did not charge. |

The constant `HostedConsent` is the set of requests that opt in to hosted
execution.

## Properties

| Property | Kind | Meaning |
|---|---|---|
| `NoOverspend` | Invariant | Holds and refund holds never exceed sponsored or paid funds. |
| `Conservation` | Invariant | Each unit is in a balance, a charge or a refund. |
| `BooksBalance` | Invariant | Each charge splits exactly into provider earnings and platform revenue. |
| `EarningsOnlyFromLocal` | Invariant | Only community charges credit a provider. |
| `HoldsMatchRoute` | Invariant | A live request holds its route's bound. A finished request holds nothing. |
| `OnlyActiveAttemptSettles` | Invariant | One charge for each request, from the active attempt and its assigned route. |
| `ChargeWithinAuthorization` | Invariant | A charge is never more than the authorized hold. |
| `NoSwitchAfterOutput` | Invariant | After output reaches the client, the attempt does not change. |
| `NoHostedWithoutConsent` | Invariant | No request reaches a hosted vendor without consent, first or as fallback. |
| `PausedIdle` | Invariant | A paused or offline node runs no IE job. |
| `SlotsExact`, `SlotsWithinCap` | Invariant | Capacity is taken once and released once for each attempt. |
| `UncertainWasSent` | Invariant | A reconciliation item refers to a hosted attempt that was sent. |
| `HostedCostTracked` | Invariant | Each sent hosted attempt without a confirmed result is open or resolved for reconciliation. |
| `RefundExactlyOnce` | Invariant | The processor moves refund money at most once, and the final ledger agrees with it. |
| `ProcessorEffectHasIntent` | Invariant | Money leaves through the processor only after a durable refund row exists. |
| `TerminalStable` | Action | A charged or released request does not change. |
| `RequestsFinish` | Liveness | Each live request becomes charged or released. |
| `UncertainResolved` | Liveness | Each reconciliation item is resolved. |
| `RefundResolves` | Liveness | A pending refund succeeds or fails. |

The liveness properties assume weak fairness for the request deadline, the
reconciliation worker, the outbox worker and the refund status poller.

The outbox worker can call the processor more than once for the same refund,
as it would after a crash between the call and the write of its result. The
model checks that the idempotency key makes this safe.

## Bounds and limits

The configuration has two requests (one with hosted consent), one local route
and one hosted route with one slot each, two attempts per request, one
payment, one sponsored grant and one refund. Usage reports go up to more than
any hold. The fee function is abstract. A successful run is a result for these
bounds only. It does not verify Python code, SQLite, Stripe, a hosted vendor,
node runtimes, timing, prices, trust evidence or tokenizer accuracy. The
refinement tests in the design document check the implementation separately.
