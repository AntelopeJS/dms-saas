---- MODULE GuardedPlanChangeSchedule ----
EXTENDS GuardedPlanChangeState

(* ---- prepareFreeChange (free.ts:64-106) ----------------------------------- *)

(* readSubscription, and the paid active check (free.ts:74-76). *)
PrepRead(s) ==
  /\ pc[s] = "idle"
  /\ IF sub.plan = "paid" /\ stripe.status = "active"
       THEN Move(s, "prepCheck", Read, NoObs, own[s])
       ELSE Go(s, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* stripe.subscriptions.retrieve and its checks (free.ts:78-92). *)
PrepCheck(s) ==
  /\ pc[s] = "prepCheck"
  /\ IF deadline \/ stripe.status # "active" \/ stripe.cancelAtEnd
       THEN Go(s, "done")
       ELSE Move(s, "prepCas", snap[s], NoObs, own[s])
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* prepareGuardedPlanChange (state.ts:36-65): refused on any existing plan
   transition; requestedAt starts the preparation timer. A throw here is
   outside the try of scheduleGuardedFreeChange, so it ends the call. *)
PrepCas(s) ==
  /\ pc[s] = "prepCas"
  /\ IF snap[s].op # None
       THEN Go(s, "done") /\ UNCHANGED <<sub, faults, elapsed, started>>
       ELSE LET prepared == [sub EXCEPT !.rev = @ + 1, !.op = s, !.barrier = s,
                                        !.phase = "preparing", !.transition = TRUE] IN
            \/ /\ Applies(s)
               /\ sub' = prepared
               /\ Move(s, "drainObserve", NoSnap, NoObs,
                       [op |-> s, barrier |-> s, phase |-> "preparing"])
               /\ elapsed' = FALSE
               /\ started' = started \cup {s}
               /\ UNCHANGED faults
            \/ /\ ~Applies(s)
               /\ Go(s, "done")
               /\ UNCHANGED <<sub, faults, elapsed, started>>
            \/ /\ Applies(s)
               /\ CanFault(s) /\ Fault
               /\ sub' = prepared
               /\ Go(s, "done")
               /\ elapsed' = FALSE
               /\ started' = started \cup {s}
            \/ /\ CanFault(s) /\ Fault
               /\ Go(s, "done")
               /\ UNCHANGED <<sub, elapsed, started>>
  /\ UNCHANGED <<life, ends, landed, staleEffect, lateCancel, lateProvider, badLanding,
                 stripe, pending, writer, deadline, closes, writes>>

(* ---- scheduleGuardedFreeChange (free.ts:116-179) -------------------------- *)

(* validateGuardedPlanChange (free.ts:125-138). Issues throw into the catch. *)
ValidatePasses(s) ==
  /\ pc[s] = "validate"
  /\ Move(s, "admitCas", snap[s], NoObs, own[s])
  /\ UNCHANGED <<sub, life, faults, History, World>>

ValidateRefuses(s) ==
  /\ pc[s] = "validate"
  /\ Go(s, "catchRead")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* admitGuardedProviderEffect (state.ts:112-120), on the revision read under the
   barrier (free.ts:139). It holds no deadline check, unlike state.ts:140. *)
AdmitCas(s) ==
  /\ pc[s] = "admitCas"
  /\ Cas(s, Patched(s, "provider_pending"), "emitRelease", "catchRead")
  /\ staleEffect' = (staleEffect \/ (sub' # sub /\ ~Applies(s)))
  /\ lateProvider' = (lateProvider \/ (sub' # sub /\ deadline))
  /\ UNCHANGED <<life, started, ends, landed, lateCancel, badLanding, World>>

(* free.ts:141-146. *)
CatchRead(s) ==
  /\ pc[s] = "catchRead"
  /\ IF sub.op = own[s].op /\ sub.phase = "preparing"
       THEN Move(s, "catchAbort", Read, NoObs, own[s])
       ELSE Go(s, "catchRelease")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* abortGuardedPreparation (state.ts:71-79). A throw here leaves the catch, so
   the release is not reached. *)
CatchAbort(s) ==
  /\ pc[s] = "catchAbort"
  /\ Cas(s, Patched(s, "aborting"), "catchRelease", "done")
  /\ UNCHANGED <<life, History, World>>

(* free.ts:148. *)
CatchRelease(s) ==
  /\ pc[s] = "catchRelease"
  /\ Release(s, "catchFinalRead", "done")
  /\ UNCHANGED <<sub, History, World>>

(* free.ts:149-155. *)
CatchFinalRead(s) ==
  /\ pc[s] = "catchFinalRead"
  /\ IF sub.op = own[s].op /\ sub.phase = "aborting"
       THEN Move(s, "catchComplete", Read, NoObs, own[s])
       ELSE Go(s, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* completeGuardedAbort (state.ts:82-93). *)
CatchComplete(s) ==
  /\ pc[s] = "catchComplete"
  /\ Cas(s, Cleared, "done", "done")
  /\ EndsOp(s, "aborted")
  /\ UNCHANGED <<life, started, staleEffect, lateCancel, lateProvider, badLanding, World>>

(* free.ts:158: inventory reopens before Stripe is called. A throw ends the call
   with the row at provider_pending and no emitter. *)
EmitRelease(s) ==
  /\ pc[s] = "emitRelease"
  /\ Release(s, "emit", "done")
  /\ UNCHANGED <<sub, History, World>>

(* free.ts:160-166: cancel_at_period_end true. *)
EmitSchedule(s) ==
  /\ pc[s] = "emit"
  /\ pending' = [pending EXCEPT ![s] = [kind |-> "schedule", op |-> own[s].op]]
  /\ Go(s, "emitWait")
  /\ UNCHANGED <<sub, life, faults, History, stripe, writer, deadline, elapsed, closes, writes>>

(* free.ts:167-176: confirmed only with the same period end. *)
ScheduleCheck(s) ==
  /\ pc[s] = "scheduleCheck"
  /\ IF stripe.cancelAtEnd /\ ~stripe.renewed
       THEN Go(s, "confirmRead")
       ELSE Go(s, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* free.ts:177 or free.ts:213: a fresh read, then requirePhase (state.ts:95-109). *)
ConfirmRead(c) ==
  /\ pc[c] = "confirmRead"
  /\ IF sub.phase = (IF c \in Schedulers THEN "provider_pending" ELSE "cancel_pending")
       THEN Move(c, "confirmCas", Read, NoObs, own[c])
       ELSE Go(c, "done")
  /\ UNCHANGED <<sub, life, faults, History, World>>

(* confirmGuardedSchedule (state.ts:123-132). *)
ConfirmSchedule(s) ==
  /\ pc[s] = "confirmCas"
  /\ s \in Schedulers
  /\ Cas(s, WithTransition(Patched(s, "scheduled"), FALSE), "done", "done")
  /\ UNCHANGED <<life, History, World>>

==============================================================================
