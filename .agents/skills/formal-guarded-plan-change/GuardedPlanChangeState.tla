-------------------------- MODULE GuardedPlanChangeState ----------------------
(***************************************************************************)
(* The guarded paid-to-Free plan change of @antelopejs/dms-saas: one       *)
(* subscription row whose guardedPlanChange moves through phases under a   *)
(* revision compare-and-set, the tenant lifecycle row of                   *)
(* @antelopejs/interface-dms as its environment, and Stripe. Each await on *)
(* the database or on Stripe is one step. A write to either row is one     *)
(* atomicMutation, a compare-and-set on `revision`.                        *)
(*                                                                         *)
(* state.ts is packages/dms-saas/src/plan-changes/guarded-state.ts,        *)
(* barrier.ts is plan-changes/inventory-barrier.ts, free.ts is             *)
(* plan-changes/guarded-free.ts, landing.ts is                             *)
(* plan-changes/guarded-landing.ts.                                        *)
(*                                                                         *)
(* The tenant lifecycle row is the environment that the dms check          *)
(* formal-tenant-lifecycle proves, so admission, finish, pause and resume  *)
(* are one step each here, at the compare-and-set that decides them.       *)
(***************************************************************************)
EXTENDS FiniteSets, Naturals

CONSTANTS
  Schedulers,  \* calls of scheduleGuardedFreeChange, each with one operation and barrier
  Cancellers,  \* calls of cancelGuardedFreeChange
  Reconcilers, \* calls of reconcileGuardedFreeChange: the cron or a Stripe webhook
  LastTick,    \* the cron tick that runs after every other call has ended
  Writers,     \* inventory writers under runTenantLifecycleOperation
  MaxWrites,   \* ordinary revision bumps, such as a webhook's status update
  MaxCloses,   \* tenant deletions closing the lifecycle row
  MaxFaults,   \* database or Stripe calls that throw or answer "unknown", and crashes
  None         \* a null operation or barrier

VARIABLES
  sub,      \* the guarded part of the tenant subscription row
  life,     \* the tenant lifecycle row
  stripe,   \* the Stripe subscription
  pc,       \* where each call is
  own,      \* the operation, barrier and phase a call acts for
  snap,     \* the subscription row a call read, for its next compare-and-set
  obs,      \* the lifecycle row a drain observed
  pending,  \* a Stripe request sent and not landed
  writer,   \* where each inventory writer is
  deadline, \* effectiveAt has passed
  elapsed,  \* INVENTORY_PREPARATION_MAX_MS has passed since the row's last timer start
  faults,   \* faults so far
  closes,   \* closes used: Init starts at MaxCloses for a tenant nobody deletes
  writes,   \* ordinary writes so far
  started,  \* the operations whose preparation landed
  ends,     \* how many times each operation ended
  landed,   \* the operations that ended on the Free plan
  staleEffect,  \* a provider request landed or was admitted outside its revision
  lateCancel,   \* a cancellation was admitted after its deadline check should stop it
  lateProvider, \* a provider effect was admitted after the deadline
  badLanding    \* the plan moved without a passed deadline and a cancelled Stripe

vars == <<sub, life, stripe, pc, own, snap, obs, pending, writer, deadline, elapsed,
          faults, closes, writes, started, ends, landed, staleEffect, lateCancel, lateProvider,
          badLanding>>

Ticks == Reconcilers \cup {LastTick}
Calls == Schedulers \cup Cancellers \cup Ticks
Barriers == Schedulers \cup Ticks \cup {None}
Ops == Schedulers \cup {None}
Phases == {"none", "preparing", "aborting", "provider_pending", "scheduled",
           "cancel_pending", "effective", "blocked", "activating"}

NoSnap == [rev |-> 0, op |-> None, barrier |-> None, phase |-> "none"]
NoObs == [rev |-> 0, barrier |-> None, empty |-> FALSE, closed |-> FALSE]
NoOwn == [op |-> None, barrier |-> None, phase |-> "none"]
NoRequest == [kind |-> "none", op |-> None]

TypeOK ==
  /\ sub \in [rev: Nat, op: Ops, phase: Phases, barrier: Barriers,
              transition: BOOLEAN, plan: {"paid", "free"}]
  /\ life \in [rev: Nat, barrier: Barriers, active: SUBSET Writers, closed: BOOLEAN]
  /\ stripe \in [cancelAtEnd: BOOLEAN, status: {"active", "canceled"},
                 periodEnded: BOOLEAN, renewed: BOOLEAN]
  /\ pending \in [Calls -> [kind: {"none", "schedule", "cancel"}, op: Ops]]
  /\ writer \in [Writers -> {"idle", "active", "failedHeld", "done", "refused"}]
  /\ deadline \in BOOLEAN /\ elapsed \in BOOLEAN
  /\ faults \in 0..MaxFaults /\ closes \in 0..MaxCloses /\ writes \in 0..MaxWrites
  /\ started \subseteq Schedulers
  /\ ends \in [Schedulers -> Nat]
  /\ landed \subseteq Schedulers

Init ==
  /\ sub = [rev |-> 0, op |-> None, phase |-> "none", barrier |-> None,
            transition |-> FALSE, plan |-> "paid"]
  /\ life = [rev |-> 0, barrier |-> None, active |-> {}, closed |-> FALSE]
  /\ stripe = [cancelAtEnd |-> FALSE, status |-> "active",
               periodEnded |-> FALSE, renewed |-> FALSE]
  /\ pc = [c \in Calls |-> "idle"]
  /\ own = [c \in Calls |-> NoOwn]
  /\ snap = [c \in Calls |-> NoSnap]
  /\ obs = [c \in Calls |-> NoObs]
  /\ pending = [c \in Calls |-> NoRequest]
  /\ writer = [w \in Writers |-> "idle"]
  /\ deadline = FALSE
  /\ elapsed = FALSE
  /\ faults = 0
  /\ closes \in {0, MaxCloses}
  /\ writes = 0
  /\ started = {}
  /\ ends = [s \in Schedulers |-> 0]
  /\ landed = {}
  /\ staleEffect = FALSE
  /\ lateCancel = FALSE
  /\ lateProvider = FALSE
  /\ badLanding = FALSE

(* ---- helpers -------------------------------------------------------------- *)

(* The last cron tick is not itself the failure being recovered from. *)
CanFault(c) == faults < MaxFaults /\ c # LastTick
Fault == faults' = faults + 1

(* A call moves, and forgets what its next step does not need. *)
Move(c, to, s, o, w) ==
  /\ pc' = [pc EXCEPT ![c] = to]
  /\ snap' = [snap EXCEPT ![c] = s]
  /\ obs' = [obs EXCEPT ![c] = o]
  /\ own' = [own EXCEPT ![c] = IF to = "done" THEN NoOwn ELSE w]

Go(c, to) == Move(c, to, NoSnap, NoObs, own[c])

Read == [rev |-> sub.rev, op |-> sub.op, barrier |-> sub.barrier, phase |-> sub.phase]

(* mutateRevision compares `revision`, then writes a fresh one
   (interface-dms-saas tenantSubscriptions.model.ts:52-67). *)
Applies(c) == sub.rev = snap[c].rev

Patched(c, phase) ==
  [sub EXCEPT !.rev = @ + 1, !.op = snap[c].op, !.barrier = snap[c].barrier, !.phase = phase]

Cleared == [sub EXCEPT !.rev = @ + 1, !.op = None, !.barrier = None, !.phase = "none",
                       !.transition = FALSE]

WithTransition(r, t) == [r EXCEPT !.transition = t]

(* Each compare-and-set answers applied, a stale conflict, or "unknown", whether
   the write landed or not. Every caller treats unknown as a throw. *)
Cas(c, next, ok, fail) ==
  \/ /\ Applies(c)
     /\ sub' = next
     /\ Go(c, ok)
     /\ UNCHANGED faults
  \/ /\ ~Applies(c)
     /\ UNCHANGED <<sub, faults>>
     /\ Go(c, fail)
  \/ /\ Applies(c)
     /\ CanFault(c) /\ Fault
     /\ sub' = next
     /\ Go(c, fail)
  \/ /\ CanFault(c) /\ Fault
     /\ UNCHANGED sub
     /\ Go(c, fail)

(* The operation that a write ends, when the write lands. *)
EndsOp(c, how) ==
  /\ ends' = IF sub'.rev # sub.rev
               THEN [ends EXCEPT ![snap[c].op] = @ + 1]
               ELSE ends
  /\ landed' = IF sub'.rev # sub.rev /\ how = "landed"
                 THEN landed \cup {snap[c].op}
                 ELSE landed

(* model.resume of interface-dms: refused on a closed row or another barrier,
   otherwise it always moves the revision, which revokes a delayed pause. *)
Resumed(b) ==
  IF life.closed \/ (life.barrier # None /\ life.barrier # b)
    THEN life
    ELSE [life EXCEPT !.rev = @ + 1, !.barrier = None]

(* releasePlanInventory (barrier.ts:59-64): the false answer is ignored, a throw is not. *)
Release(c, ok, fail) ==
  \/ /\ life' = Resumed(own[c].barrier)
     /\ Go(c, ok)
     /\ UNCHANGED faults
  \/ /\ CanFault(c) /\ Fault
     /\ life' = Resumed(own[c].barrier)
     /\ Go(c, fail)
  \/ /\ CanFault(c) /\ Fault
     /\ UNCHANGED life
     /\ Go(c, fail)

History == <<started, ends, landed, staleEffect, lateCancel, lateProvider, badLanding>>
World == <<stripe, pending, writer, deadline, elapsed, closes, writes>>

(* isGuardedPlanChangeBlocked (state.ts:8-19). *)
IsBlocked ==
  /\ sub.op # None
  /\ sub.phase # "aborting"
  /\ (sub.phase = "blocked" \/ deadline)

(* ---- drainPlanInventory (barrier.ts:22-56), by a scheduler or a landing ---- *)

Thrown(c) == IF c \in Schedulers THEN "catchRead" ELSE "landCatch"
Drained(c) == IF c \in Schedulers THEN "validate" ELSE "landValidate"

(* barrier.ts:29: observe before reading the intent. *)
DrainObserve(c) ==
  /\ pc[c] = "drainObserve"
  /\ Move(c, "drainRead", NoSnap,
          [rev |-> life.rev, barrier |-> life.barrier,
           empty |-> life.active = {}, closed |-> life.closed],
          own[c])
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* barrier.ts:30-50. *)
DrainRead(c) ==
  /\ pc[c] = "drainRead"
  /\ IF sub.barrier # own[c].barrier \/ sub.phase # own[c].phase \/ obs[c].closed
       THEN Go(c, Thrown(c))
       ELSE IF obs[c].barrier = own[c].barrier
         THEN IF obs[c].empty
                THEN Move(c, Drained(c), Read, NoObs, own[c])
                ELSE Go(c, "drainWait")
         ELSE IF obs[c].barrier # None
           THEN Go(c, Thrown(c))
           ELSE Move(c, "pause", NoSnap, obs[c], own[c])
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* model.pause of interface-dms: one compare-and-set on the observed revision,
   and a false answer goes on polling. *)
Pause(c) ==
  /\ pc[c] = "pause"
  /\ \/ /\ IF ~life.closed /\ life.barrier = None /\ life.rev = obs[c].rev
             THEN life' = [life EXCEPT !.rev = @ + 1, !.barrier = own[c].barrier]
             ELSE UNCHANGED life
        /\ Go(c, "drainWait")
        /\ UNCHANGED faults
     \/ /\ CanFault(c) /\ Fault
        /\ UNCHANGED life
        /\ Go(c, Thrown(c))
  /\ UNCHANGED <<sub, History, World>>

(* barrier.ts:51, and the loop's test of DRAIN_WAIT_MS at barrier.ts:28. *)
DrainAgain(c) ==
  /\ pc[c] = "drainWait"
  /\ Go(c, "drainObserve")
  /\ UNCHANGED <<sub, life, faults, History, World>>

DrainTimesOut(c) ==
  /\ pc[c] = "drainWait"
  /\ Go(c, Thrown(c))
  /\ UNCHANGED <<sub, life, faults, History, World>>

==============================================================================
