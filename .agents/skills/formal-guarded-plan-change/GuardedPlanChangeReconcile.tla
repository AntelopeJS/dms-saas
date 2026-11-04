---- MODULE GuardedPlanChangeReconcile ----
EXTENDS GuardedPlanChangeState

(* ---- reconcileGuardedFreeChange (landing.ts:172-219) ----------------------- *)

OthersEnded ==
  /\ \A c \in Schedulers \cup Cancellers \cup Reconcilers : pc[c] = "done"

(* landing.ts:175-177, then the branches of recoverInventoryPreparation
   (landing.ts:114-160). The webhook of a Stripe cancellation (deferred.ts:321)
   and the cron (crons/reconcile-guarded-downgrades.ts) both call this. *)
ReconcileRead(r) ==
  /\ pc[r] = "idle"
  /\ r = LastTick => (OthersEnded /\ writes = MaxWrites /\ (elapsed \/ sub.op = None))
  /\ LET w == [op |-> sub.op, barrier |-> sub.barrier, phase |-> sub.phase] IN
       IF sub.op = None
         THEN Go(r, "done")
       ELSE IF sub.phase = "preparing"
         THEN IF elapsed THEN Move(r, "recAbort", Read, NoObs, w) ELSE Go(r, "done")
       ELSE IF sub.phase = "aborting"
         THEN Move(r, "recAbortingRelease", Read, NoObs, w)
       ELSE IF sub.phase = "effective"
         THEN IF elapsed THEN Move(r, "recExpire", Read, NoObs, w) ELSE Go(r, "done")
       ELSE Move(r, "recRelease", Read, NoObs, w)
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* landing.ts:125. *)
RecAbort(r) ==
  /\ pc[r] = "recAbort"
  /\ Cas(r, Patched(r, "aborting"), "recAbortRelease", "done")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:126. *)
RecAbortRelease(r) ==
  /\ pc[r] = "recAbortRelease"
  /\ Release(r, "recAbortRead", "done")
  /\ UNCHANGED <<sub, History, World>>

(* landing.ts:127-133: this site does compare the operation. *)
RecAbortRead(r) ==
  /\ pc[r] = "recAbortRead"
  /\ IF sub.op = own[r].op /\ sub.phase = "aborting"
       THEN Move(r, "recAbortComplete", Read, NoObs, own[r])
       ELSE Go(r, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

RecAbortComplete(r) ==
  /\ pc[r] = "recAbortComplete"
  /\ Cas(r, Cleared, "done", "done")
  /\ EndsOp(r, "aborted")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

(* landing.ts:137-140: the phase was read at the start of this call. *)
RecAbortingRelease(r) ==
  /\ pc[r] = "recAbortingRelease"
  /\ \/ /\ life' = Resumed(own[r].barrier)
        /\ Move(r, "recAbortingComplete", snap[r], NoObs, own[r])
        /\ UNCHANGED faults
     \/ /\ CanFault(r) /\ Fault
        /\ life' = Resumed(own[r].barrier)
        /\ Go(r, "done")
     \/ /\ CanFault(r) /\ Fault
        /\ UNCHANGED life
        /\ Go(r, "done")
  /\ UNCHANGED <<sub, History, World>>

RecAbortingComplete(r) ==
  /\ pc[r] = "recAbortingComplete"
  /\ Cas(r, Cleared, "done", "done")
  /\ EndsOp(r, "aborted")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

(* landing.ts:148-153: recordBlocked, whose patch clears domainTransition. *)
RecExpire(r) ==
  /\ pc[r] = "recExpire"
  /\ Cas(r, WithTransition(Patched(r, "blocked"), FALSE), "recExpireRelease", "done")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:154. *)
RecExpireRelease(r) ==
  /\ pc[r] = "recExpireRelease"
  /\ Release(r, "done", "done")
  /\ UNCHANGED <<sub, History, World>>

(* landing.ts:179-199. The deadline is read after the release. *)
RecRelease(r) ==
  /\ pc[r] = "recRelease"
  /\ LET next == IF own[r].phase = "activating" THEN "recComplete"
                 ELSE IF ~deadline THEN "done"
                 ELSE IF own[r].phase \notin {"scheduled", "blocked"} THEN "recPreserve"
                 ELSE "recStripe" IN
     \/ /\ life' = Resumed(own[r].barrier)
        /\ Move(r, next, IF next = "done" THEN NoSnap ELSE snap[r], NoObs, own[r])
        /\ UNCHANGED faults
     \/ /\ CanFault(r) /\ Fault
        /\ life' = Resumed(own[r].barrier)
        /\ Go(r, "done")
     \/ /\ CanFault(r) /\ Fault
        /\ UNCHANGED life
        /\ Go(r, "done")
  /\ UNCHANGED <<sub, History, World>>

(* landing.ts:186-196: recordBlocked with preserveProviderPhase. *)
RecPreserve(r) ==
  /\ pc[r] = "recPreserve"
  /\ Cas(r, Patched(r, own[r].phase), "done", "done")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:202-206. *)
RecStripe(r) ==
  /\ pc[r] = "recStripe"
  /\ IF stripe.status = "canceled"
       THEN Move(r, "recEffective", snap[r], NoObs, own[r])
       ELSE Move(r, "recNotCancelled", snap[r], NoObs, own[r])
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* landing.ts:208-213: recordBlocked. *)
RecNotCancelled(r) ==
  /\ pc[r] = "recNotCancelled"
  /\ Cas(r, WithTransition(Patched(r, "blocked"), FALSE), "done", "done")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:228-239: a fresh barrier and validationStartedAt. The write is outside
   the try, so a conflict ends the call. *)
RecEffective(r) ==
  /\ pc[r] = "recEffective"
  /\ LET w == [op |-> own[r].op, barrier |-> r, phase |-> "effective"]
         next == [sub EXCEPT !.rev = @ + 1, !.op = snap[r].op, !.barrier = r,
                             !.phase = "effective"] IN
     \/ /\ Applies(r)
        /\ sub' = next
        /\ elapsed' = FALSE
        /\ Move(r, "drainObserve", NoSnap, NoObs, w)
        /\ UNCHANGED faults
     \/ /\ ~Applies(r)
        /\ Go(r, "done")
        /\ UNCHANGED <<sub, elapsed, faults>>
     \/ /\ Applies(r)
        /\ CanFault(r) /\ Fault
        /\ sub' = next
        /\ elapsed' = FALSE
        /\ Go(r, "done")
     \/ /\ CanFault(r) /\ Fault
        /\ Go(r, "done")
        /\ UNCHANGED <<sub, elapsed>>
  /\ UNCHANGED <<life, History, stripe, pending, writer, deadline, closes, writes>>

(* landing.ts:243-262: the target plan check and validateGuardedPlanChange. *)
LandPasses(r) ==
  /\ pc[r] = "landValidate"
  /\ Move(r, "landCommit", snap[r], NoObs, own[r])
  /\ UNCHANGED <<sub, life, faults, History, World>>

LandRefuses(r) ==
  /\ pc[r] = "landValidate"
  /\ Move(r, "landBlock", snap[r], NoObs, own[r])
  /\ UNCHANGED <<sub, life, faults, History, World>>

LandUnavailable(r) ==
  /\ pc[r] = "landValidate"
  /\ Go(r, "landCatch")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* landing.ts:266-282: the plan moves in this one compare-and-set, on the row
   read under the barrier. *)
LandCommit(r) ==
  /\ pc[r] = "landCommit"
  /\ Cas(r, [Patched(r, "activating") EXCEPT !.plan = "free", !.transition = FALSE],
         "landFinally", "landCatch")
  /\ badLanding' = (badLanding \/
                     (sub' # sub /\ ~(deadline /\ stripe.status = "canceled")))
  /\ UNCHANGED <<life, started, ends, landed, staleEffect, lateCancel, lateProvider, World>>

(* landing.ts:264: recordBlocked on the drained row. A throw goes to the catch. *)
LandBlock(r) ==
  /\ pc[r] = "landBlock"
  /\ Cas(r, WithTransition(Patched(r, "blocked"), FALSE), "landFinally", "landCatch")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:284-301. *)
LandCatch(r) ==
  /\ pc[r] = "landCatch"
  /\ IF sub.barrier = own[r].barrier /\ sub.phase = "effective"
       THEN Move(r, "landCatchBlock", Read, NoObs, own[r])
       ELSE Go(r, "landFinallyThrown")
  /\ UNCHANGED <<sub, life, faults, History, World>>

LandCatchBlock(r) ==
  /\ pc[r] = "landCatchBlock"
  /\ Cas(r, WithTransition(Patched(r, "blocked"), FALSE), "landFinally", "landFinallyThrown")
  /\ UNCHANGED <<life, History, World>>

(* landing.ts:302-304, on the way to the read after it. *)
LandFinally(r) ==
  /\ pc[r] = "landFinally"
  /\ Release(r, "landLatest", "done")
  /\ UNCHANGED <<sub, History, World>>

(* landing.ts:302-304, with the catch's error still propagating. *)
LandFinallyThrown(r) ==
  /\ pc[r] = "landFinallyThrown"
  /\ Release(r, "done", "done")
  /\ UNCHANGED <<sub, History, World>>

(* landing.ts:305-308. *)
LandLatest(r) ==
  /\ pc[r] = "landLatest"
  /\ IF sub.phase = "activating"
       THEN Move(r, "recComplete", Read, NoObs, own[r])
       ELSE Go(r, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* completeFreeActivation (landing.ts:84-111): the final compare-and-set. *)
RecComplete(r) ==
  /\ pc[r] = "recComplete"
  /\ Cas(r, Cleared, "done", "done")
  /\ EndsOp(r, "landed")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

==============================================================================
