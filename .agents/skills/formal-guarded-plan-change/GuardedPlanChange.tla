-------------------------- MODULE GuardedPlanChange --------------------------
(***************************************************************************)
(* The environment, the next-state relation and the rules of the guarded   *)
(* plan change. GuardedPlanChangeState holds the variables and the drain,  *)
(* and each other module holds one entry point of plan-changes/.           *)
(***************************************************************************)
EXTENDS GuardedPlanChangeSchedule, GuardedPlanChangeCancel, GuardedPlanChangeReconcile

(* ---- the environment ------------------------------------------------------- *)

(* runTenantLifecycleOperation's model.admit, proved by formal-tenant-lifecycle:
   refused on a closed row or a barrier, otherwise an admission. *)
WriterAdmit(w) ==
  /\ writer[w] = "idle"
  /\ IF life.closed \/ life.barrier # None
       THEN writer' = [writer EXCEPT ![w] = "refused"] /\ UNCHANGED life
       ELSE /\ writer' = [writer EXCEPT ![w] = "active"]
            /\ life' = [life EXCEPT !.rev = @ + 1, !.active = @ \cup {w}]
  /\ UNCHANGED <<sub, stripe, pc, own, snap, obs, pending, deadline, elapsed, faults,
                 closes, writes, History>>

WriterFinishes(w) ==
  /\ writer[w] = "active"
  /\ writer' = [writer EXCEPT ![w] = "done"]
  /\ life' = [life EXCEPT !.rev = @ + 1, !.active = @ \ {w}]
  /\ UNCHANGED <<sub, stripe, pc, own, snap, obs, pending, deadline, elapsed, faults,
                 closes, writes, History>>

(* A failed attempt keeps its admission for good (formal-tenant-lifecycle). *)
WriterFails(w) ==
  /\ writer[w] = "active"
  /\ writer' = [writer EXCEPT ![w] = "failedHeld"]
  /\ UNCHANGED <<sub, life, stripe, pc, own, snap, obs, pending, deadline, elapsed, faults,
                 closes, writes, History>>

(* closeTenantLifecycleAdmission, from the tenant deletion hook. *)
Close ==
  /\ closes < MaxCloses
  /\ closes' = closes + 1
  /\ life' = IF life.closed THEN life ELSE [life EXCEPT !.rev = @ + 1, !.closed = TRUE]
  /\ UNCHANGED <<sub, stripe, pc, own, snap, obs, pending, writer, deadline, elapsed,
                 faults, writes, History>>

(* model.update (interface-dms-saas tenantSubscriptions.model.ts:79-100): refused
   during a transition, otherwise one revision bump, such as
   updateSubscriptionStatus (stripe/webhook-shared.ts:55-77). *)
OrdinaryWrite ==
  /\ writes < MaxWrites
  /\ writes' = writes + 1
  /\ sub' = IF sub.transition THEN sub ELSE [sub EXCEPT !.rev = @ + 1]
  /\ UNCHANGED <<life, stripe, pc, own, snap, obs, pending, writer, deadline, elapsed,
                 faults, closes, History>>

DeadlinePasses ==
  /\ ~deadline
  /\ deadline' = TRUE
  /\ UNCHANGED <<sub, life, stripe, pc, own, snap, obs, pending, writer, elapsed, faults,
                 closes, writes, History>>

Tick ==
  /\ ~elapsed
  /\ sub.op # None
  /\ elapsed' = TRUE
  /\ UNCHANGED <<sub, life, stripe, pc, own, snap, obs, pending, writer, deadline, faults,
                 closes, writes, History>>

(* Stripe's own clock: it cancels at the period end when asked to, else it renews.
   The webhook this emits only starts a Reconciler. *)
StripePeriodEnds ==
  /\ deadline
  /\ ~stripe.periodEnded
  /\ stripe' = IF stripe.cancelAtEnd
                 THEN [stripe EXCEPT !.periodEnded = TRUE, !.status = "canceled"]
                 ELSE [stripe EXCEPT !.periodEnded = TRUE, !.renewed = TRUE]
  /\ UNCHANGED <<sub, life, pc, own, snap, obs, pending, writer, deadline, elapsed, faults,
                 closes, writes, History>>

(* A process that dies between two awaits. *)
Crash(c) ==
  /\ pc[c] \notin {"idle", "done"}
  /\ CanFault(c) /\ Fault
  /\ Go(c, "done")
  /\ UNCHANGED <<sub, life, History, World>>

(* ---- the next-state relation ----------------------------------------------- *)

DrainStep(c) ==
  \/ DrainObserve(c) \/ DrainRead(c) \/ Pause(c) \/ DrainAgain(c) \/ DrainTimesOut(c)

SchedulerStep(s) ==
  \/ PrepRead(s) \/ PrepCheck(s) \/ PrepCas(s) \/ DrainStep(s)
  \/ ValidatePasses(s) \/ ValidateRefuses(s) \/ AdmitCas(s)
  \/ CatchRead(s) \/ CatchAbort(s) \/ CatchRelease(s) \/ CatchFinalRead(s) \/ CatchComplete(s)
  \/ EmitRelease(s) \/ EmitSchedule(s) \/ EmitAcked(s) \/ EmitTimesOut(s)
  \/ ScheduleCheck(s) \/ ConfirmRead(s) \/ ConfirmSchedule(s)
  \/ ProviderLands(s) \/ ProviderLost(s) \/ Crash(s)

CancellerStep(c) ==
  \/ CancelRead(c) \/ CancelAbort(c) \/ CancelRelease(c) \/ CancelFinalRead(c)
  \/ CancelComplete(c) \/ CancelAdmit(c) \/ CancelEmit(c) \/ EmitAcked(c) \/ EmitTimesOut(c)
  \/ CancelCheck(c) \/ ConfirmRead(c) \/ ConfirmCancel(c)
  \/ ProviderLands(c) \/ ProviderLost(c) \/ Crash(c)

ReconcilerStep(r) ==
  \/ ReconcileRead(r) \/ RecAbort(r) \/ RecAbortRelease(r) \/ RecAbortRead(r)
  \/ RecAbortComplete(r) \/ RecAbortingRelease(r) \/ RecAbortingComplete(r)
  \/ RecExpire(r) \/ RecExpireRelease(r) \/ RecRelease(r) \/ RecPreserve(r) \/ RecStripe(r)
  \/ RecNotCancelled(r) \/ RecEffective(r) \/ DrainStep(r)
  \/ LandPasses(r) \/ LandRefuses(r) \/ LandUnavailable(r) \/ LandCommit(r) \/ LandBlock(r)
  \/ LandCatch(r) \/ LandCatchBlock(r) \/ LandFinally(r) \/ LandFinallyThrown(r)
  \/ LandLatest(r) \/ RecComplete(r) \/ Crash(r)

Environment ==
  \/ \E w \in Writers : WriterAdmit(w) \/ WriterFinishes(w) \/ WriterFails(w)
  \/ Close \/ OrdinaryWrite \/ DeadlinePasses \/ Tick \/ StripePeriodEnds

Busy ==
  \/ \E s \in Schedulers : SchedulerStep(s)
  \/ \E c \in Cancellers : CancellerStep(c)
  \/ \E r \in Ticks : ReconcilerStep(r)
  \/ Environment

(* Once nothing more can happen. A drain's poll loop goes through other states, so
   it never reads as quiescent, and DrainTimesOut leaves it under fairness. *)
Quiescent == ~ENABLED <<Busy>>_vars

Done == Quiescent /\ UNCHANGED vars

Next == Busy \/ Done

Spec == Init /\ [][Next]_vars

(* ---- the rules ------------------------------------------------------------- *)

(* A Stripe request is admitted only on the revision its caller read, and lands
   only while the row still names that operation in that request's phase. *)
NoStaleProviderEffect == ~staleEffect

(* From a drain's return until its compare-and-set or the revocation of its phase,
   the barrier stays and no writer is active, so the count it validated stands. *)
InventoryFrozen ==
  \A c \in Calls :
    (pc[c] \in {"validate", "admitCas", "landValidate", "landCommit", "landBlock"}
       /\ sub.barrier = own[c].barrier
       /\ sub.phase = own[c].phase)
      => (life.barrier = own[c].barrier /\ life.active = {})

(* Each prepared operation ends exactly once unless it is still the row's, and
   only the landing moves the plan. *)
OneEnd ==
  /\ \A s \in Schedulers : ends[s] <= 1
  /\ \A s \in started : ends[s] = 1 \/ sub.op = s
  /\ sub.plan = "free" => (sub.phase = "activating" \/ (sub.op = None /\ landed # {}))

(* Past effectiveAt, or once blocked, the gate is closed unless the change is
   aborting, and no cancellation passes its deadline check. *)
DeadlineBlocks ==
  /\ (sub.op # None /\ sub.phase # "aborting" /\ (deadline \/ sub.phase = "blocked"))
       => IsBlocked
  /\ ~lateCancel

(* The converse: before effectiveAt nothing blocks the workspace, so a paid
   tenant keeps the period it paid for. *)
NoBlockBeforeDeadline == ~deadline => ~IsBlocked

(* The exemption of DeadlineBlocks: a change being undone keeps the gate open,
   past effectiveAt too, since the abort keeps the paid plan (state.ts:14). *)
AbortingKeepsAccess == sub.phase = "aborting" => ~IsBlocked

(* The same deadline, for the other provider effect. *)
DeadlineStopsProviderEffect == ~lateProvider

(* The plan moves only past the deadline, with Stripe's cancellation confirmed. *)
LandsOnlyWhenCancelled == ~badLanding

(* Stated in the state where nothing more can happen, since the shared runner
   checks invariants only: every barrier was released, unless a deletion closed
   the row. LastTick is the next cron run after every call has ended or died. *)
AdmissionResumes == Quiescent => (life.barrier = None \/ life.closed)

(* ---- the temporal form, run by Live.cfg outside the shared runner ----------- *)

FairSpec ==
  /\ Spec
  /\ \A s \in Schedulers : WF_vars(SchedulerStep(s))
  /\ \A c \in Cancellers : WF_vars(CancellerStep(c))
  /\ \A r \in Ticks : WF_vars(ReconcilerStep(r))
  /\ WF_vars(Environment)
  /\ \A c \in Schedulers \cup Ticks : SF_vars(DrainTimesOut(c))

BarrierHeld == life.barrier # None /\ ~life.closed

EventuallyQuiescent == <>Quiescent

AdmissionResumesLive == BarrierHeld ~> ~BarrierHeld

==============================================================================
