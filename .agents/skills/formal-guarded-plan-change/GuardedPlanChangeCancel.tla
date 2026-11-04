---- MODULE GuardedPlanChangeCancel ----
EXTENDS GuardedPlanChangeState

(* ---- cancelGuardedFreeChange (free.ts:182-214) ---------------------------- *)

CancelRead(c) ==
  /\ pc[c] = "idle"
  /\ LET w == [op |-> sub.op, barrier |-> sub.barrier, phase |-> sub.phase] IN
       IF sub.op = None
         THEN Go(c, "done") /\ UNCHANGED lateCancel
       ELSE IF sub.phase = "preparing"
         THEN Move(c, "cancelAbort", Read, NoObs, w) /\ UNCHANGED lateCancel
       ELSE IF sub.phase = "aborting"
         THEN Move(c, "cancelRelease", NoSnap, NoObs, w) /\ UNCHANGED lateCancel
       ELSE IF sub.phase = "scheduled" /\ ~IsBlocked
         THEN Move(c, "cancelAdmit", Read, NoObs, w)
              /\ lateCancel' = (lateCancel \/ deadline)
       ELSE Go(c, "done") /\ UNCHANGED lateCancel
  /\ UNCHANGED <<sub, life, faults, started, ends, landed, staleEffect, lateProvider, badLanding, World>>

(* free.ts:188-189. *)
CancelAbort(c) ==
  /\ pc[c] = "cancelAbort"
  /\ Cas(c, Patched(c, "aborting"), "cancelRelease", "done")
  /\ UNCHANGED <<life, History, World>>

(* free.ts:190. *)
CancelRelease(c) ==
  /\ pc[c] = "cancelRelease"
  /\ Release(c, "cancelFinalRead", "done")
  /\ UNCHANGED <<sub, History, World>>

(* free.ts:191: a fresh read, and requirePhase("aborting") names no operation. *)
CancelFinalRead(c) ==
  /\ pc[c] = "cancelFinalRead"
  /\ IF sub.phase = "aborting"
       THEN Move(c, "cancelComplete", Read, NoObs, own[c])
       ELSE Go(c, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

CancelComplete(c) ==
  /\ pc[c] = "cancelComplete"
  /\ Cas(c, Cleared, "done", "done")
  /\ EndsOp(c, "aborted")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

(* admitGuardedCancellation (state.ts:135-151). *)
CancelAdmit(c) ==
  /\ pc[c] = "cancelAdmit"
  /\ Cas(c, WithTransition(Patched(c, "cancel_pending"), TRUE), "cancelEmit", "done")
  /\ UNCHANGED <<life, History, World>>

(* free.ts:196-202: cancel_at_period_end false. *)
CancelEmit(c) ==
  /\ pc[c] = "cancelEmit"
  /\ pending' = [pending EXCEPT ![c] = [kind |-> "cancel", op |-> own[c].op]]
  /\ Go(c, "emitWait")
  /\ UNCHANGED <<sub, life, faults, History, stripe, writer, deadline, elapsed, closes, writes>>

(* free.ts:203-212. *)
CancelCheck(c) ==
  /\ pc[c] = "cancelCheck"
  /\ IF stripe.status = "active" /\ ~stripe.cancelAtEnd
       THEN Go(c, "confirmRead")
       ELSE Go(c, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* confirmGuardedCancellation (state.ts:154-165). *)
ConfirmCancel(c) ==
  /\ pc[c] = "confirmCas"
  /\ c \in Cancellers
  /\ Cas(c, Cleared, "done", "done")
  /\ EndsOp(c, "aborted")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

(* ---- the Stripe request of either emitter ---------------------------------- *)

(* Answers once the request landed. A timeout throws with the request still in
   flight, and no code ever inverts it. *)
EmitAcked(c) ==
  /\ pc[c] = "emitWait"
  /\ pending[c].kind = "none"
  /\ Go(c, IF c \in Schedulers THEN "scheduleCheck" ELSE "cancelCheck")
  /\ UNCHANGED <<sub, life, faults, History, World>>

EmitTimesOut(c) ==
  /\ pc[c] = "emitWait"
  /\ CanFault(c) /\ Fault
  /\ Go(c, "done")
  /\ UNCHANGED <<sub, life, History, World>>

PendingPhase(k) == IF k = "schedule" THEN "provider_pending" ELSE "cancel_pending"

(* A request lands whatever its emitter does next. It changes nothing on a
   subscription Stripe already cancelled. *)
ProviderLands(c) ==
  /\ pending[c].kind # "none"
  /\ stripe' = IF stripe.status = "active"
                 THEN [stripe EXCEPT !.cancelAtEnd = (pending[c].kind = "schedule")]
                 ELSE stripe
  /\ staleEffect' = (staleEffect \/ sub.op # pending[c].op
                                 \/ sub.phase # PendingPhase(pending[c].kind))
  /\ pending' = [pending EXCEPT ![c] = NoRequest]
  /\ UNCHANGED <<sub, life, pc, own, snap, obs, writer, deadline, elapsed, faults, closes,
                 writes, started, ends, landed, lateCancel, lateProvider, badLanding>>

(* A request whose emitter is gone may also never land. *)
ProviderLost(c) ==
  /\ pending[c].kind # "none"
  /\ pc[c] = "done"
  /\ pending' = [pending EXCEPT ![c] = NoRequest]
  /\ UNCHANGED <<sub, life, stripe, pc, own, snap, obs, writer, deadline, elapsed, faults,
                 closes, writes, History>>

==============================================================================
