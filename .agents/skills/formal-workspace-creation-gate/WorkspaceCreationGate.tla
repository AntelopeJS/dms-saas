------------------------- MODULE WorkspaceCreationGate -------------------------
(* The creation gate of a workspace registration: one row of the lifecycle
   deliveries (`saas_lifecycle_deliveries`, consumer `$workspace-created`),
   written by the registration, by the lifecycle cron ticks and by the
   registration's own delivery.

   The row's `revision` moves on every write. Every write is one compare-and-set
   on the revision its caller read, so a caller acting on a stale read changes
   nothing. `provisioningState` is the registration's decision: `preparing`,
   then `awaiting_payment`, then `committed`, or `cancelled`. `status` is the
   delivery's: `pending`, `running` (a claim holds it), `failed`, `succeeded`.

   Files below are under packages/dms-saas/src/operator-actions/:
   `model` is db/lifecycle-delivery.model.ts, `outbox` is lifecycle-outbox.ts,
   `provisioning` is ../workspaces/provisioning.ts. Each database round trip is
   one step. A step that fails goes to its caller's catch.

   Left out: crashes, the 10-minute lease (longer than any actor here, so a
   `running` row is never retaken), database faults and `unknown` outcomes,
   trials (no invoice), a deleted tenant, the other lifecycle consumers. *)
EXTENDS Naturals, TLC

CONSTANTS
  Registration,   \* the one registration of the workspace
  Ticks,          \* the cron ticks, each one reconcile run
  GuardPreparing, \* TRUE: model.ts:31 keeps a `preparing` gate off the claim
  Attempts,       \* model.ts:14 PROVISIONING_ATTEMPTS; 1 is a single compare-and-set
  None

Actors == {Registration} \cup Ticks

VARIABLES
  row,              \* the gate: provisioningState P, status, claim, revision
  invoicePaid,      \* Stripe's invoice, read by the consumer (outbox.ts:187-190)
  pc,               \* where each actor is
  snap,             \* the row as that actor last read it
  tx,               \* the compare-and-set loop of that actor
  lostDecision,     \* a decision's compare-and-set gave up while its state was unchanged
  claimedPreparing, \* a claim applied to a gate in `preparing`
  everCommitted,
  everCancelled

vars == <<row, invoicePaid, pc, snap, tx, lostDecision, claimedPreparing,
          everCommitted, everCancelled>>

NoRow == [P |-> "none", status |-> "pending", claim |-> None, rev |-> 0,
          wasSucceeded |-> FALSE]
NoTx == [ctx |-> "none", exp |-> "none", next |-> "none", tries |-> 0]

Init ==
  /\ row = NoRow
  /\ invoicePaid = FALSE
  /\ pc = [a \in Actors |-> IF a = Registration THEN "start" ELSE "idle"]
  /\ snap = [a \in Actors |-> NoRow]
  /\ tx = [a \in Actors |-> NoTx]
  /\ lostDecision = FALSE
  /\ claimedPreparing = FALSE
  /\ everCommitted = FALSE
  /\ everCancelled = FALSE

Go(a, p) == pc' = [pc EXCEPT ![a] = p]

\* Where a finished `transitionProvisioning` returns, by its caller.
OkTo(ctx) ==
  CASE ctx = "prepare" -> "pay"
    [] ctx = "cancel" -> "done"
    [] ctx = "commit" -> "markOkRead"

\* Where a thrown `transitionProvisioning` goes: the registration's error ends it,
\* the consumer's goes to the catch of invokeConsumer (outbox.ts:293-295).
FailTo(ctx) ==
  CASE ctx = "prepare" -> "done"
    [] ctx = "cancel" -> "done"
    [] ctx = "commit" -> "markFailRead"

Claimable(s) ==
  /\ s.status \in {"pending", "failed"}               \* model.ts:32, `running` is leased (model.ts:33-34)
  /\ (GuardPreparing => s.P /= "preparing")           \* model.ts:31

(* ---- the registration ---- *)

\* beginWorkspaceCreation (outbox.ts:207-220)
Insert ==
  /\ pc[Registration] = "start"
  /\ row.P = "none"
  /\ row' = [P |-> "preparing", status |-> "pending", claim |-> None, rev |-> 1,
             wasSucceeded |-> FALSE]
  /\ Go(Registration, "choose")
  /\ UNCHANGED <<invoicePaid, snap, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* Either every provisioning step succeeds and the gate is prepared
\* (provisioning.ts:354), or a step before it fails and the rollback cancels
\* (provisioning-rollback.ts:22-29).
Choose ==
  /\ pc[Registration] = "choose"
  /\ \/ /\ tx' = [tx EXCEPT ![Registration] =
                    [ctx |-> "prepare", exp |-> "preparing",
                     next |-> "awaiting_payment", tries |-> 0]]
        /\ Go(Registration, "trRead")
     \/ /\ Go(Registration, "cancelRead")
        /\ UNCHANGED tx
  /\ UNCHANGED <<row, invoicePaid, snap, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* cancelWorkspaceCreated reads the gate, then transitions from the state it read
\* (outbox.ts:246-261).
CancelRead ==
  /\ pc[Registration] = "cancelRead"
  /\ IF row.P \in {"preparing", "awaiting_payment"}
       THEN /\ tx' = [tx EXCEPT ![Registration] =
                        [ctx |-> "cancel", exp |-> row.P,
                         next |-> "cancelled", tries |-> 0]]
            /\ Go(Registration, "trRead")
       ELSE /\ Go(Registration, "done")
            /\ UNCHANGED tx
  /\ UNCHANGED <<row, invoicePaid, snap, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* settleSubscriptionPayment charges the invoice (provisioning.ts:356-375): paid,
\* then the registration delivers; a card decline cancels the gate.
Pay ==
  /\ pc[Registration] = "pay"
  /\ \/ /\ invoicePaid' = TRUE
        /\ Go(Registration, "deliverRead")
     \/ /\ Go(Registration, "cancelRead")
        /\ UNCHANGED invoicePaid
  /\ UNCHANGED <<row, snap, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* The customer, or Stripe's retry of the invoice, pays it while the gate waits.
InvoicePaidElsewhere ==
  /\ ~invoicePaid
  /\ row.P = "awaiting_payment"
  /\ invoicePaid' = TRUE
  /\ UNCHANGED <<row, pc, snap, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

(* ---- transitionProvisioning: one pass of its loop (model.ts:56-73) ---- *)

TrRead(a) ==
  /\ pc[a] = "trRead"
  /\ LET c == tx[a] IN
     IF row.P = c.next
       THEN /\ Go(a, OkTo(c.ctx))                     \* model.ts:60-63
            /\ UNCHANGED snap
       ELSE IF row.P /= c.exp
         THEN /\ Go(a, FailTo(c.ctx))                 \* model.ts:64-65
              /\ UNCHANGED snap
         ELSE /\ Go(a, "trCas")
              /\ snap' = [snap EXCEPT ![a] = row]
  /\ UNCHANGED <<row, invoicePaid, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

TrCas(a) ==
  /\ pc[a] = "trCas"
  /\ LET c == tx[a] IN
     \/ /\ row.rev = snap[a].rev                       \* model.ts:66-67 applied
        /\ row' = [row EXCEPT !.P = c.next, !.rev = @ + 1,
                    !.status = IF c.next = "cancelled" THEN "succeeded" ELSE @,
                    !.wasSucceeded = @ \/ c.next = "cancelled"]
        /\ everCommitted' = (everCommitted \/ c.next = "committed")
        /\ everCancelled' = (everCancelled \/ c.next = "cancelled")
        /\ Go(a, OkTo(c.ctx))
        /\ UNCHANGED <<tx, lostDecision>>
     \/ /\ row.rev /= snap[a].rev                      \* not-applied
        /\ IF c.tries + 1 < Attempts
             THEN /\ tx' = [tx EXCEPT ![a].tries = @ + 1]
                  /\ Go(a, "trRead")
                  /\ UNCHANGED lostDecision
             ELSE /\ Go(a, FailTo(c.ctx))              \* model.ts:73 contended
                  /\ lostDecision' = (lostDecision \/ row.P = c.exp)
                  /\ UNCHANGED tx
        /\ UNCHANGED <<row, everCommitted, everCancelled>>
  /\ UNCHANGED <<invoicePaid, snap, claimedPreparing>>

(* ---- deliverOne: a cron tick, or the registration's own delivery ---- *)

\* findReplayable (model.ts:81-90) hands the tick the rows it may claim.
TickRead(t) ==
  /\ pc[t] = "idle"
  /\ IF row.P /= "none" /\ Claimable(row)
       THEN /\ Go(t, "claim")
            /\ snap' = [snap EXCEPT ![t] = row]
       ELSE /\ Go(t, "done")
            /\ UNCHANGED snap
  /\ UNCHANGED <<row, invoicePaid, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* deliverWorkspaceCreated reads the gate by id (outbox.ts:264-270, 299-304).
DeliverRead ==
  /\ pc[Registration] = "deliverRead"
  /\ IF row.status = "succeeded"
       THEN /\ Go(Registration, "done")
            /\ UNCHANGED snap
       ELSE /\ Go(Registration, "claim")
            /\ snap' = [snap EXCEPT ![Registration] = row]
  /\ UNCHANGED <<row, invoicePaid, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* claim (model.ts:97-111): refused on a delivery it cannot take, fenced on the
\* revision it read.
Claim(a) ==
  /\ pc[a] = "claim"
  /\ IF Claimable(snap[a]) /\ row.rev = snap[a].rev
       THEN /\ row' = [row EXCEPT !.status = "running", !.claim = a, !.rev = @ + 1]
            /\ claimedPreparing' = (claimedPreparing \/ row.P = "preparing")
            /\ Go(a, "consGet")
       ELSE /\ Go(a, "done")
            /\ UNCHANGED <<row, claimedPreparing>>
  /\ UNCHANGED <<invoicePaid, snap, tx, lostDecision, everCommitted, everCancelled>>

\* consumeCreationIntent reads the gate (outbox.ts:171-182).
ConsGet(a) ==
  /\ pc[a] = "consGet"
  /\ CASE row.P = "preparing" -> /\ Go(a, "markFailRead")        \* outbox.ts:176-178
                                 /\ UNCHANGED tx
       [] row.P = "cancelled" -> /\ Go(a, "markOkRead")          \* outbox.ts:179-180
                                 /\ UNCHANGED tx
       [] row.P = "awaiting_payment" -> /\ Go(a, "consInvoice")  \* outbox.ts:184-191
                                        /\ UNCHANGED tx
       [] OTHER -> /\ tx' = [tx EXCEPT ![a] =
                              [ctx |-> "commit", exp |-> "awaiting_payment",
                               next |-> "committed", tries |-> 0]]
                   /\ Go(a, "trRead")
  /\ UNCHANGED <<row, invoicePaid, snap, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

ConsInvoice(a) ==
  /\ pc[a] = "consInvoice"
  /\ IF invoicePaid
       THEN /\ tx' = [tx EXCEPT ![a] =
                        [ctx |-> "commit", exp |-> "awaiting_payment",
                         next |-> "committed", tries |-> 0]]   \* outbox.ts:193-197
            /\ Go(a, "trRead")
       ELSE /\ Go(a, "markFailRead")                           \* outbox.ts:190-191
            /\ UNCHANGED tx
  /\ UNCHANGED <<row, invoicePaid, snap, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* markSucceeded (model.ts:114-138)
MarkOkRead(a) ==
  /\ pc[a] = "markOkRead"
  /\ IF row.status = "succeeded"                               \* model.ts:120
       THEN /\ Go(a, "done")
            /\ UNCHANGED snap
       ELSE /\ Go(a, "markOkCas")
            /\ snap' = [snap EXCEPT ![a] = row]
  /\ UNCHANGED <<row, invoicePaid, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

MarkOkCas(a) ==
  /\ pc[a] = "markOkCas"
  /\ IF row.rev = snap[a].rev
       THEN /\ row' = [row EXCEPT !.status = "succeeded", !.rev = @ + 1,
                                   !.wasSucceeded = TRUE]
            /\ Go(a, "done")
       ELSE /\ Go(a, IF row.status = "succeeded" THEN "done" ELSE "markFailRead")
            /\ UNCHANGED row                                   \* model.ts:131-138
  /\ UNCHANGED <<invoicePaid, snap, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

\* markFailed (model.ts:141-154): a lost compare-and-set is not an error.
MarkFailRead(a) ==
  /\ pc[a] = "markFailRead"
  /\ IF row.status = "succeeded" \/ row.claim /= a             \* model.ts:143-144
       THEN /\ Go(a, "done")
            /\ UNCHANGED snap
       ELSE /\ Go(a, "markFailCas")
            /\ snap' = [snap EXCEPT ![a] = row]
  /\ UNCHANGED <<row, invoicePaid, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

MarkFailCas(a) ==
  /\ pc[a] = "markFailCas"
  /\ IF row.rev = snap[a].rev
       THEN row' = [row EXCEPT !.status = "failed", !.rev = @ + 1]
       ELSE UNCHANGED row
  /\ Go(a, "done")
  /\ UNCHANGED <<invoicePaid, snap, tx, lostDecision, claimedPreparing,
                 everCommitted, everCancelled>>

(* ---- the model ---- *)

Quiescent == \A a \in Actors : pc[a] = "done"

Terminated == Quiescent /\ UNCHANGED vars

Next ==
  \/ Insert \/ Choose \/ CancelRead \/ Pay \/ DeliverRead \/ InvoicePaidElsewhere
  \/ \E a \in Actors :
       \/ TrRead(a) \/ TrCas(a) \/ Claim(a) \/ ConsGet(a) \/ ConsInvoice(a)
       \/ MarkOkRead(a) \/ MarkOkCas(a) \/ MarkFailRead(a) \/ MarkFailCas(a)
  \/ \E t \in Ticks : TickRead(t)
  \/ Terminated

Spec == Init /\ [][Next]_vars

(* ---- the rules ---- *)

TypeOK ==
  /\ row.P \in {"none", "preparing", "awaiting_payment", "committed", "cancelled"}
  /\ row.status \in {"pending", "running", "failed", "succeeded"}
  /\ row.claim \in Actors \cup {None}
  /\ row.wasSucceeded \in BOOLEAN
  /\ invoicePaid \in BOOLEAN
  /\ \A a \in Actors : pc[a] \in
       {"start", "choose", "cancelRead", "pay", "deliverRead", "idle", "done",
        "trRead", "trCas", "claim", "consGet", "consInvoice", "markOkRead",
        "markOkCas", "markFailRead", "markFailCas"}

\* A decision of the registration (prepare, cancel) or of a delivery (commit) never
\* gives up while the state it wants to leave is still the row's: a claim, or the
\* outcome of one, moved the revision without deciding anything.
DecisionNotLost == ~lostDecision

\* Once every actor stopped, the gate is neither `preparing` nor `running`.
NoStuckGate == Quiescent => (row.P /= "preparing" /\ row.status /= "running")

\* No claim applies to a gate its registration still holds in `preparing`.
NoClaimOfHeldGate == ~claimedPreparing

\* A cancelled gate is never committed and a committed one never cancelled.
OneDecision == ~(everCommitted /\ everCancelled)

\* No gate commits before its invoice is paid.
CommitNeedsPayment == row.P = "committed" => invoicePaid

\* A succeeded delivery stays succeeded: a failure never overwrites it (model.ts:143).
SucceededFinal == row.wasSucceeded => row.status = "succeeded"

\* Never two actors inside one delivery attempt (model.ts:97-111, "never invoke the
\* consumer twice").
InAttempt(a) ==
  \/ pc[a] \in {"consGet", "consInvoice", "markOkRead", "markOkCas",
                "markFailRead", "markFailCas"}
  \/ /\ pc[a] \in {"trRead", "trCas"}
     /\ tx[a].ctx = "commit"

SingleClaimant == \A a, b \in Actors : (a /= b) => ~(InAttempt(a) /\ InAttempt(b))
=============================================================================
