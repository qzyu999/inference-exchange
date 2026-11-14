------------------------------ MODULE PaidPath ------------------------------
(***************************************************************************)
(* Paid inference path: wallet, request lifecycle, capacity and refunds,   *)
(* with supply from two directions: a node behind the IE agent (any        *)
(* runtime) and a hosted vendor (DeepInfra or Novita).                     *)
(* One step is one committed SQLite transaction or one external event.     *)
(* An event whose guard fails has no effect. README.md links to the        *)
(* proposed paid path design on issue #297.                               *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, HostedConsent
ASSUME Requests # {} /\ HostedConsent \subseteq Requests

\* "local" is any node behind the IE agent (home Mac or data center, any
\* runtime); "hosted" is an external vendor called by the coordinator (ROUTE-009).
Routes == {"local", "hosted"}
HoldOf == [rt \in Routes |-> IF rt = "local" THEN 2 ELSE 3]
CapOf == [rt \in Routes |-> 1]   \* one slot per node in the model
MaxAttempt == 2
TopUp == 3            \* one confirmed processor payment
Grant == 1            \* sponsored credit, never refundable
RefundAmount == 1
MaxUsage == 4         \* a provider can report more than any hold
MinCharge == 1        \* BILL-004
Fee(c) == c \div 2    \* abstract platform fee; BILL-002 fixes the real rate
BillInterrupted == FALSE  \* owner decision D1; check.py runs both values

Attempts == 1..MaxAttempt
Keys == Requests \X Attempts
Live == {"held", "rerouting", "running", "streaming"}
Upstream == {"running", "streaming"}
Terminal == {"charged", "released"}
Phases == {"new"} \cup Live \cup Terminal
LocalStates == {"available", "draining", "paused", "offline"}

VARIABLES paid, sponsored, credited, req, sent, slots, uncertain, refund,
          absorbed, local, earned, revenue, rejected, resolved,
          outbox, procState, procMoved
wallet == <<paid, sponsored, credited, refund>>
books == <<absorbed, earned, revenue>>
audit == <<rejected, resolved>>
proc == <<outbox, procState, procMoved>>
vars == <<paid, sponsored, credited, req, sent, slots, uncertain, refund,
          absorbed, local, earned, revenue, rejected, resolved,
          outbox, procState, procMoved>>

Min(a, b) == IF a < b THEN a ELSE b
Max(a, b) == IF a > b THEN a ELSE b

RECURSIVE SumF(_, _)
SumF(f, S) == IF S = {} THEN 0
              ELSE LET x == CHOOSE y \in S : TRUE IN f[x] + SumF(f, S \ {x})

Debit(r) == req[r].debitS + req[r].debitP
HeldS == SumF([r \in Requests |-> req[r].holdS], Requests)
HeldP == SumF([r \in Requests |-> req[r].holdP], Requests)
SpentS == SumF([r \in Requests |-> req[r].debitS], Requests)
SpentP == SumF([r \in Requests |-> req[r].debitP], Requests)
RefundHold == IF refund = "pending" THEN RefundAmount ELSE 0
Refunded == IF refund = "succeeded" THEN RefundAmount ELSE 0
SponsoredFree == sponsored - HeldS
PaidFree == paid - HeldP - RefundHold
Available == SponsoredFree + PaidFree

\* Hosted execution is external: the request must opt in (ROUTE-009, D4).
Allowed(r, rt) == rt = "hosted" => r \in HostedConsent

EmptyReq == [phase |-> "new", route |-> "none", attempt |-> 0,
             holdS |-> 0, holdP |-> 0, debitS |-> 0, debitP |-> 0,
             settledBy |-> 0, settledFrom |-> "none", outputAt |-> 0]

Init ==
  /\ paid = 0
  /\ sponsored = Grant
  /\ credited = FALSE
  /\ req = [r \in Requests |-> EmptyReq]
  /\ sent = {}
  /\ slots = [rt \in Routes |-> 0]
  /\ uncertain = {}
  /\ refund = "none"
  /\ absorbed = 0
  /\ local = "offline"
  /\ earned = 0
  /\ revenue = 0
  /\ rejected = {}
  /\ resolved = {}
  /\ outbox = "none"
  /\ procState = "none"
  /\ procMoved = 0

\* Verified webhook. A duplicate delivery of the same payment ID is a no-op.
CreditPayment ==
  /\ ~credited
  /\ credited' = TRUE
  /\ paid' = paid + TopUp
  /\ UNCHANGED <<proc, audit, sponsored, req, sent, slots, uncertain, refund, books, local>>

\* Hold the route's maximum charge. Sponsored credit is drawn first.
Reserve(r, rt) ==
  /\ req[r].phase = "new"
  /\ Allowed(r, rt)
  /\ Available >= HoldOf[rt]
  /\ LET s == Min(HoldOf[rt], SponsoredFree)
     IN req' = [req EXCEPT ![r].phase = "held", ![r].route = rt,
                           ![r].holdS = s, ![r].holdP = HoldOf[rt] - s]
  /\ UNCHANGED <<proc, audit, wallet, sent, slots, uncertain, books, local>>

\* Record the attempt and take a slot before the external send. A node that
\* is paused, draining or offline gets no new IE job.
Dispatch(r) ==
  /\ req[r].phase = "held"
  /\ req[r].attempt < MaxAttempt
  /\ slots[req[r].route] < CapOf[req[r].route]
  /\ (req[r].route = "local" => local = "available")
  /\ LET a == req[r].attempt + 1
     IN /\ req' = [req EXCEPT ![r].phase = "running", ![r].attempt = a]
        /\ sent' = sent \cup {<<r, a, req[r].route>>}
  /\ slots' = [slots EXCEPT ![req[r].route] = @ + 1]
  /\ UNCHANGED <<proc, audit, wallet, uncertain, books, local>>

\* Any connected provider can send a frame for any request ID it knows.
\* Only the active attempt, from the provider that received it, is accepted.
Accepts(r, a, from) ==
  /\ req[r].phase \in Upstream
  /\ req[r].attempt = a
  /\ <<r, a, from>> \in sent

\* Definite rejection before any output: free the slot, then pick a new route.
DefiniteReject(r, a, from) ==
  /\ Accepts(r, a, from)
  /\ req[r].phase = "running"
  /\ req' = [req EXCEPT ![r].phase = "rerouting"]
  /\ slots' = [slots EXCEPT ![req[r].route] = @ - 1]
  /\ rejected' = rejected \cup {<<r, a>>}
  /\ UNCHANGED <<proc, resolved, wallet, sent, uncertain, books, local>>

\* Atomically replace the hold with the next route's bound. Fallback from a
\* node to a hosted vendor needs the same consent as a first choice.
Resize(r, rt) ==
  /\ req[r].phase = "rerouting"
  /\ (rt = "hosted" => r \in HostedConsent)
  /\ LET sf == SponsoredFree + req[r].holdS
         pf == PaidFree + req[r].holdP
         s == Min(HoldOf[rt], sf)
     IN /\ sf + pf >= HoldOf[rt]
        /\ req' = [req EXCEPT ![r].phase = "held", ![r].route = rt,
                              ![r].holdS = s, ![r].holdP = HoldOf[rt] - s]
  /\ UNCHANGED <<proc, audit, wallet, sent, slots, uncertain, books, local>>

DeliverOutput(r, a, from) ==
  /\ Accepts(r, a, from)
  /\ req[r].phase = "running"
  /\ req' = [req EXCEPT ![r].phase = "streaming", ![r].outputAt = a]
  /\ UNCHANGED <<proc, audit, wallet, sent, slots, uncertain, books, local>>

\* One transaction: debit within the hold, release the rest, free the slot.
\* A community charge splits into provider earnings and the fee (P7). A
\* hosted charge is platform revenue; the vendor cost is a separate record.
Settle(r, a, charge, from) ==
  LET dS == Min(charge, req[r].holdS)
      dP == charge - dS
      earn == IF req[r].route = "local" THEN charge - Fee(charge) ELSE 0
  IN /\ req' = [req EXCEPT ![r].phase = "charged", ![r].holdS = 0, ![r].holdP = 0,
                           ![r].debitS = dS, ![r].debitP = dP,
                           ![r].settledBy = a, ![r].settledFrom = from]
     /\ sponsored' = sponsored - dS
     /\ paid' = paid - dP
     /\ slots' = [slots EXCEPT ![req[r].route] = @ - 1]
     /\ earned' = earned + earn
     /\ revenue' = revenue + (charge - earn)

\* Usage above the authorized bound is capped and kept for reconciliation.
Complete(r, a, from, usage) ==
  /\ Accepts(r, a, from)
  /\ LET hold == req[r].holdS + req[r].holdP
         billable == Max(usage, MinCharge)
         charge == Min(billable, hold)
     IN /\ Settle(r, a, charge, from)
        /\ absorbed' = absorbed + (billable - charge)
  /\ UNCHANGED <<proc, audit, credited, refund, sent, uncertain, local>>

\* A sent hosted attempt can carry a vendor cost that IE must reconcile. A
\* community provider is paid only through a charge, so it leaves no item.
Owed(r) == IF req[r].route = "hosted" THEN {<<r, req[r].attempt>>} ELSE {}

\* Policy D1 = TRUE: an interrupted stream pays for measured delivered output.
ChargeInterrupted(r, delivered) ==
  /\ BillInterrupted
  /\ req[r].phase = "streaming"
  /\ delivered \in MinCharge..(req[r].holdS + req[r].holdP)
  /\ Settle(r, req[r].attempt, delivered, req[r].route)
  /\ uncertain' = uncertain \cup Owed(r)
  /\ UNCHANGED <<proc, audit, credited, refund, sent, absorbed, local>>

\* Timeout, ambiguous acceptance, error or disconnect after the send.
Fail(r) ==
  /\ req[r].phase \in Upstream
  /\ req' = [req EXCEPT ![r].phase = "released", ![r].holdS = 0, ![r].holdP = 0]
  /\ uncertain' = uncertain \cup Owed(r)
  /\ slots' = [slots EXCEPT ![req[r].route] = @ - 1]
  /\ UNCHANGED <<proc, audit, wallet, sent, books, local>>

\* No upstream call is outstanding: cancel, deadline, or no eligible route.
Cancel(r) ==
  /\ req[r].phase \in {"held", "rerouting"}
  /\ req' = [req EXCEPT ![r].phase = "released", ![r].holdS = 0, ![r].holdP = 0]
  /\ UNCHANGED <<proc, audit, wallet, sent, slots, uncertain, books, local>>

Expire(r) == Fail(r) \/ Cancel(r)

\* The node's agent registers. Old-session frames stay unaccepted because the
\* requests they belong to are no longer live.
LocalConnect ==
  /\ local = "offline"
  /\ local' = "available"
  /\ UNCHANGED <<proc, audit, wallet, req, sent, slots, uncertain, books>>

\* Pause offers or local work needs the GPU. A running IE job finishes first.
LocalPause ==
  /\ local = "available"
  /\ local' = IF slots["local"] = 0 THEN "paused" ELSE "draining"
  /\ UNCHANGED <<proc, audit, wallet, req, sent, slots, uncertain, books>>

LocalDrained ==
  /\ local = "draining"
  /\ slots["local"] = 0
  /\ local' = "paused"
  /\ UNCHANGED <<proc, audit, wallet, req, sent, slots, uncertain, books>>

LocalResume ==
  /\ local = "paused"
  /\ local' = "available"
  /\ UNCHANGED <<proc, audit, wallet, req, sent, slots, uncertain, books>>

\* The runtime stops, the machine sleeps, or the WebSocket drops. Its jobs fail.
LocalOffline ==
  /\ local # "offline"
  /\ local' = "offline"
  /\ LET gone == {r \in Requests : req[r].phase \in Upstream /\ req[r].route = "local"}
     IN req' = [r \in Requests |->
                  IF r \in gone
                  THEN [req[r] EXCEPT !.phase = "released", !.holdS = 0, !.holdP = 0]
                  ELSE req[r]]
  /\ slots' = [slots EXCEPT !["local"] = 0]
  /\ UNCHANGED <<proc, audit, wallet, sent, uncertain, books>>

\* Coordinator restart: memory is lost, SQLite is kept. Committed charges and
\* a pending refund survive. Sent hosted attempts become reconciliation items.
\* Providers must register again.
Restart ==
  /\ \E r \in Requests : req[r].phase \in Live
  /\ req' = [r \in Requests |->
               IF req[r].phase \in Live
               THEN [req[r] EXCEPT !.phase = "released", !.holdS = 0, !.holdP = 0]
               ELSE req[r]]
  /\ uncertain' = uncertain \cup
       UNION {Owed(r) : r \in {x \in Requests : req[x].phase \in Upstream}}
  /\ slots' = [rt \in Routes |-> 0]
  /\ local' = "offline"
  /\ UNCHANGED <<proc, audit, wallet, sent, books>>

Reconcile(k) ==
  /\ k \in uncertain
  /\ uncertain' = uncertain \ {k}
  /\ resolved' = resolved \cup {k}
  /\ UNCHANGED <<proc, rejected, wallet, req, sent, slots, books, local>>

\* Hold eligible paid credit and write the outbox row in one transaction.
\* No processor call happens inside the transaction.
HoldRefund ==
  /\ refund = "none"
  /\ PaidFree >= RefundAmount
  /\ refund' = "pending"
  /\ outbox' = "queued"
  /\ UNCHANGED <<procState, procMoved, audit, paid, sponsored, credited, req, sent, slots, uncertain, books, local>>

\* The outbox worker calls the processor with the refund ID as idempotency
\* key. It may crash before it records the call, so it may call again. The
\* processor applies a key once and returns the first result on a replay.
SendRefund(ok) ==
  /\ outbox = "queued"
  /\ IF procState = "none"
     THEN /\ procState' = IF ok THEN "succeeded" ELSE "failed"
          /\ procMoved' = IF ok THEN 1 ELSE 0
     ELSE /\ procState' = procState
          /\ procMoved' = procMoved
  /\ UNCHANGED <<outbox, audit, wallet, req, sent, slots, uncertain, books, local>>

\* A signed processor event or a status poll. Only the first one for this
\* refund changes the ledger; a duplicate finds the refund already final.
FinishRefund ==
  /\ refund = "pending"
  /\ procState # "none"
  /\ refund' = procState
  /\ outbox' = "done"
  /\ paid' = paid - (IF procState = "succeeded" THEN RefundAmount ELSE 0)
  /\ UNCHANGED <<procState, procMoved, audit, sponsored, credited, req, sent, slots, uncertain, books, local>>

Next ==
  \/ CreditPayment \/ HoldRefund \/ Restart
  \/ LocalConnect \/ LocalPause \/ LocalDrained \/ LocalResume \/ LocalOffline
  \/ FinishRefund \/ \E ok \in BOOLEAN : SendRefund(ok)
  \/ \E k \in Keys : Reconcile(k)
  \/ \E r \in Requests :
       \/ Dispatch(r) \/ Expire(r)
       \/ \E rt \in Routes : Reserve(r, rt) \/ Resize(r, rt)
       \/ \E d \in 1..MaxUsage : ChargeInterrupted(r, d)
       \/ \E a \in Attempts, from \in Routes :
            \/ DefiniteReject(r, a, from) \/ DeliverOutput(r, a, from)
            \/ \E u \in 0..MaxUsage : Complete(r, a, from, u)

Spec == Init /\ [][Next]_vars

\* Deadlines, the reconciliation worker, the outbox worker and the refund
\* poller eventually run.
Fairness ==
  /\ \A r \in Requests : WF_vars(Expire(r))
  /\ \A k \in Keys : WF_vars(Reconcile(k))
  /\ WF_vars(\E ok \in BOOLEAN : SendRefund(ok))
  /\ WF_vars(FinishRefund)

FairSpec == Spec /\ Fairness

---------------------------------------------------------------------------
TypeOK ==
  /\ paid \in 0..TopUp /\ sponsored \in 0..Grant /\ credited \in BOOLEAN
  /\ \A r \in Requests :
       /\ req[r].phase \in Phases
       /\ req[r].route \in Routes \cup {"none"}
       /\ req[r].attempt \in 0..MaxAttempt
       /\ req[r].holdS \in 0..Grant /\ req[r].holdP \in 0..TopUp
       /\ req[r].debitS \in 0..Grant /\ req[r].debitP \in 0..TopUp
       /\ req[r].settledBy \in 0..MaxAttempt
       /\ req[r].settledFrom \in Routes \cup {"none"}
       /\ req[r].outputAt \in 0..MaxAttempt
  /\ sent \subseteq Requests \X Attempts \X Routes
  /\ slots \in [Routes -> 0..Cardinality(Requests)]
  /\ uncertain \subseteq Keys
  /\ refund \in {"none", "pending", "succeeded", "failed"}
  /\ absorbed \in Nat /\ earned \in Nat /\ revenue \in Nat
  /\ local \in LocalStates
  /\ rejected \subseteq Keys /\ resolved \subseteq Keys
  /\ outbox \in {"none", "queued", "done"}
  /\ procState \in {"none", "succeeded", "failed"}
  /\ procMoved \in 0..2

\* Holds and refund holds never exceed the funds they draw on.
NoOverspend == SponsoredFree >= 0 /\ PaidFree >= 0

\* Every micro-USD is in a balance, a charge or a refund.
Conservation ==
  /\ paid + SpentP + Refunded = IF credited THEN TopUp ELSE 0
  /\ sponsored + SpentS = Grant

\* Every charge is split exactly into provider earnings and platform revenue.
BooksBalance == earned + revenue = SpentS + SpentP

\* Only community charges credit a provider; hosted charges never do.
EarningsOnlyFromLocal ==
  earned = SumF([r \in Requests |->
                   IF req[r].phase = "charged" /\ req[r].route = "local"
                   THEN Debit(r) - Fee(Debit(r)) ELSE 0], Requests)

\* A live request holds exactly its route's bound; a finished one holds nothing.
HoldsMatchRoute ==
  \A r \in Requests :
    IF req[r].phase \in Live
    THEN req[r].holdS + req[r].holdP = HoldOf[req[r].route]
    ELSE req[r].holdS = 0 /\ req[r].holdP = 0

\* One charge per request, from the active attempt and its assigned provider.
OnlyActiveAttemptSettles ==
  \A r \in Requests :
    IF req[r].phase = "charged"
    THEN /\ req[r].settledBy = req[r].attempt
         /\ req[r].settledFrom = req[r].route
         /\ <<r, req[r].settledBy, req[r].settledFrom>> \in sent
         /\ Debit(r) >= MinCharge
    ELSE /\ Debit(r) = 0
         /\ req[r].settledBy = 0

\* The customer never pays more than the bound shown at authorization.
ChargeWithinAuthorization ==
  \A r \in Requests : req[r].phase = "charged" => Debit(r) <= HoldOf[req[r].route]

NoSwitchAfterOutput ==
  \A r \in Requests : req[r].outputAt > 0 => req[r].outputAt = req[r].attempt

\* No request reaches a hosted vendor without its consent, first or fallback.
NoHostedWithoutConsent ==
  \A k \in sent : k[3] = "hosted" => k[1] \in HostedConsent

\* A paused or offline node runs no IE job.
PausedIdle == local \in {"paused", "offline"} => slots["local"] = 0

\* Capacity is taken once per active attempt and released once.
SlotsExact ==
  \A rt \in Routes :
    slots[rt] = Cardinality({r \in Requests : req[r].phase \in Upstream /\ req[r].route = rt})

SlotsWithinCap == \A rt \in Routes : slots[rt] <= CapOf[rt]

\* A reconciliation item refers to a hosted attempt that was sent.
UncertainWasSent == \A k \in uncertain : <<k[1], k[2], "hosted">> \in sent

\* A sent hosted attempt that the vendor did not definitely reject, and that
\* is not running or settled by a confirmed completion, is open or resolved
\* for reconciliation. IE never forgets a possible vendor cost.
HostedCostTracked ==
  \A r \in Requests, a \in Attempts :
    ( /\ <<r, a, "hosted">> \in sent
      /\ <<r, a>> \notin rejected
      /\ ~(req[r].phase \in Upstream /\ req[r].attempt = a)
      /\ ~(req[r].phase = "charged" /\ req[r].settledBy = a) )
    => <<r, a>> \in uncertain \cup resolved

\* The processor moves refund money at most once, and the ledger agrees with
\* it once the refund is final.
RefundExactlyOnce ==
  /\ procMoved <= 1
  /\ refund \in {"succeeded", "failed"} =>
       procMoved = (IF refund = "succeeded" THEN 1 ELSE 0)

\* Money that left through the processor always has a durable refund row.
ProcessorEffectHasIntent ==
  procMoved > 0 => refund \in {"pending", "succeeded"}

TerminalStable ==
  [][\A r \in Requests : req[r].phase \in Terminal => req'[r] = req[r]]_vars

RequestsFinish == \A r \in Requests : (req[r].phase \in Live) ~> (req[r].phase \in Terminal)
UncertainResolved == \A k \in Keys : (k \in uncertain) ~> (k \notin uncertain)
RefundResolves == (refund = "pending") ~> (refund \in {"succeeded", "failed"})
=============================================================================
