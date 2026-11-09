---
name: formal-guarded-plan-change
description: TLA+ model of the guarded paid-to-Free plan change of @antelopejs/dms-saas (prepare, the inventory barrier, the Stripe effect under a revision compare-and-set, cancellation, the deadline and the landing), checked with TLC. Use when a change touches a file in its coverage record, or when a change to a guarded plan change, its barrier or its deadline needs proof that Stripe and the inventory stay in step.
---

# Formal check: guarded plan change

A paid-to-Free downgrade first publishes its target on the subscription row (`guardedPlanChange`, phase `preparing`). It then pauses tenant inventory writers through the dms admission barrier, validates the inventory, and admits one Stripe request by a compare-and-set on the row's `revision`. Later it lands at `effectiveAt` or aborts. A cancellation, the minute cron and Stripe webhooks run the same phases from other processes, in any order. Every write to the row is one compare-and-set, so a caller acting on a stale read fails rather than overwriting.

The model treats each database round trip and each Stripe call as one step. TLC checks every order of those steps across schedulers, a canceller, reconcilers (the cron or a webhook), an inventory writer, an ordinary row writer (a webhook's status update), a tenant deletion, the deadline, and Stripe's own period end, within the bounds below. A database call can throw or answer `unknown`, a Stripe request can time out and still land later, and any call can die between two steps. The promise it checks is that Stripe and the inventory move only under the revision and the barrier that allowed it, that each change ends once, and that the deadline holds.

The tenant lifecycle row is the environment. Its own check, `formal-tenant-lifecycle` in AntelopeJS/dms, proves admission, pause and resume. So here each of those is one step, at the compare-and-set that decides it.

- `GuardedPlanChangeState.tla` holds the variables, the helpers and the drain. `GuardedPlanChangeSchedule.tla`, `GuardedPlanChangeCancel.tla` and `GuardedPlanChangeReconcile.tla` each hold one entry point. `GuardedPlanChange.tla` holds the environment, the next-state relation and the rules. Each condition carries a `file.ts:NN` comment, and the header of `GuardedPlanChangeState.tla` says what `state.ts`, `barrier.ts`, `free.ts` and `landing.ts` stand for.
- `Healthy.cfg` (no fault), `Faults.cfg` (faults and crashes) and `Races.cfg` (two operations, one after the other, with a stale canceller) are the full configurations. Each has a `.ci.cfg` twin, the CI configuration.
- `Live.cfg` states `AdmissionResumes` as a temporal property. The shared runner does not read it (see the rules below).
- `GuardedPlanChange.map.mjs` and `chart-landing.cfg` are for reading results with `/statechart`.

## Run it

From the repository root, with Node 24 and `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`):

```sh
node .agents/skills/formal-guarded-plan-change/check.mjs          # CI configuration
node .agents/skills/formal-guarded-plan-change/check.mjs --full   # full configuration
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. Each run checks `Healthy`, then `Faults`, then `Races`.

| Configuration | Schedulers, cancellers, reconcilers, writers, ordinary writes, closes, faults | States (healthy, faults, races) | Wall time |
| --- | --- | --- | --- |
| CI (`<config>.ci.cfg`) | Healthy 1, 1, 1, 1, 1, 1, 0; Faults 1, 1, 1, 1, 0, 0, 1; Races 2, 1, 0, 0, 0, 0, 1 | 597,155, 100,872, 80,112 | 13 to 16 s |
| Full (`<config>.cfg`) | Healthy 2, 1, 1, 1, 1, 1, 0; Faults 1, 1, 2, 1, 1, 1, 2; Races 2, 1, 1, 0, 0, 0, 1 | 39,708,133, 15,387,242, 1,115,272 | 978 s |

Each configuration also has the last cron tick. The CI times are three runs with byte-identical output, in Java 25 on a shared 32-core machine with a load average between 20 and 50. The full time is one run, in the `eclipse-temurin:21-jre` image on a shared 16-core machine with a load average between 30 and 225. The states count the run of the rules that hold.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path. The run stops at the first configuration that changed.
- Exit 2 means TLC or Java could not run, or the arguments were wrong.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints as lowercase `holds`.

A rule with a recorded finding is judged by the length of its shortest counterexample alone. So a change that adds a longer counterexample to `AdmissionResumes` exits 0 while the finding stands. The trace printed after `BROKEN` comes from a run on every core, so its length can vary between runs, and when a break violates two rules either can be named. Only the exit code and the fact of a `BROKEN` line are stable. Findings run on one worker, so their lengths are stable.

## When to run it

Run `--full` when a change touches a file in the coverage record below, or this folder. A changed rule (exit 1) means the change broke a promise, or the model no longer describes the code. CI runs the CI configuration on every push. dms-saas has no V5 verification skill yet, so no `verify.config.ts` entry gates a diff on this check. Add the `formal` entry when that skill lands.

## The rules

| Rule | Plain sentence | Harm when it breaks | Healthy | Faults | Races |
| --- | --- | --- | --- | --- | --- |
| `NoStaleProviderEffect` | A Stripe request is admitted only on the revision its caller read, and lands only while the row still names that operation in that request's phase. | Stripe is told to cancel or keep a subscription that the row says something else about. | holds | holds | holds |
| `InventoryFrozen` | From a drain's return until its compare-and-set, while the row still holds that phase, the barrier stays and no inventory writer is active. | The seat count validated for Free is not the one that lands. | holds | holds | holds |
| `OneEnd` | Each prepared operation ends exactly once unless it is still the row's, and only the landing moves the plan to Free. | A change is lost without ending, ends twice, or the plan moves outside a landing. | holds | holds | holds |
| `DeadlineBlocks` | Past `effectiveAt`, or once blocked, the access gate is closed unless the change is aborting, and no cancellation passes its deadline check. | A tenant keeps paid features past the paid period. | holds | holds | holds |
| `NoBlockBeforeDeadline` | Before `effectiveAt`, the gate stays open. | A paying tenant is blocked inside the period it paid for. | holds | holds | holds |
| `AbortingKeepsAccess` | While a change is aborting, the gate stays open, past `effectiveAt` too. | A tenant whose downgrade is being undone loses the paid plan it keeps. | holds | holds | holds |
| `DeadlineStopsProviderEffect` | No Stripe schedule request is admitted after `effectiveAt`. | Stripe is changed after the period ended, and the change is stuck. | holds | holds | holds |
| `LandsOnlyWhenCancelled` | The plan moves to Free only past `effectiveAt`, with Stripe's cancellation confirmed. | A tenant lands on Free while Stripe still bills them. | holds | holds | holds |
| `AdmissionResumes` | Once nothing more can happen, no barrier is held, unless a deletion closed the row. | Every inventory write of the tenant is refused with 409 for good. | holds | holds | finding F2 (27, 28) |

`TypeOK` holds too. The numbers in brackets are the states of TLC's shortest counterexample, CI then full, which `check.mjs` records per configuration.

The plan that proposed this check named five rules. Its `DeadlineBlocks` says paid execution is blocked past `effectiveAt`. The model splits that promise by effect: `DeadlineBlocks` for the access gate and the cancellation, `DeadlineStopsProviderEffect` for the Stripe schedule request, and `LandsOnlyWhenCancelled` for the plan itself. `NoBlockBeforeDeadline` was added because a seeded change that lands before the deadline passed all of them. `AbortingKeepsAccess` was added because a seeded change that drops the gate's aborting exemption passed every rule. `DeadlineBlocks` follows the code's own test, `isGuardedPlanChangeBlocked`, plus the deadline check of `admitGuardedCancellation`. `DeadlineStopsProviderEffect` follows the same deadline check in `admitGuardedProviderEffect`, added to fix finding F1.

`AdmissionResumes` is a liveness rule stated as an invariant, because the shared runner checks invariants only. A drain polls in a loop, so the model has cycles. Under fairness the poll gives up (`DrainTimesOut`, strong fairness), so every behaviour ends in a state with no step that changes anything (`Quiescent`), and the rule asks for no barrier there. The cron runs every minute, so the model ends with one more cron tick, `LastTick`, which runs after every other call has ended or died, after the preparation timer has run out. A barrier still held after that tick stays held.

`Live.cfg` checks the temporal form, `<>Quiescent` and `BarrierHeld ~> ~BarrierHeld`, with weak fairness per actor and strong fairness on the drain's timeout. Rerun it by hand after a change to the model, from a scratch copy of the `.tla` files and `Live.cfg`, since it writes next to its input:

```sh
java -cp ~/.cache/antelopejs-formal/tla2tools-1.7.4.jar tlc2.TLC -config Live.cfg -deadlock GuardedPlanChange.tla
```

On the current model, TLC reports no error with 45,307 distinct states. On the scratch change `catch-skips-release` from the last section it reports `Temporal properties were violated`. The shared runner cannot run this file, because it writes only `INVARIANT` lines into its config, so CI runs the invariant form.

## Findings on the code

Each finding was replayed on the real code with the Vitest harness. [findings.md](findings.md) has TLC's path and the observed answers of each replay.

- **F1, `DeadlineStopsProviderEffect`, every configuration, fixed.** `admitGuardedProviderEffect` had no deadline check, so a validation that outlasted `effectiveAt` still sent the Stripe schedule request, and the change was stuck in `provider_pending`. AntelopeJS/dms-saas#206. It now throws past `effectiveAt` (guarded-state.ts:120), the scheduler's catch aborts the preparation, and `test/guarded-free-downgrade.test.ts` replays the finding.
- **F2, `AdmissionResumes`, `Races`.** A stale `cancelGuardedFreeChange` completes another operation's abort (free.ts:191, state.ts:95-109), and that operation's barrier is never released. AntelopeJS/dms-saas#207.
- **F3, `AdmissionResumes`, full `Faults` only, fixed.** A stalled landing completed another landing's activation, and that landing's barrier was never released. The landing now completes only the activation it wrote (landing.ts:305-309). AntelopeJS/dms-saas#209.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of the `.tla` files, the map and `chart-landing.cfg` in a scratch folder outside the repo, since it writes its output next to its input. Use `GuardedPlanChange.map.mjs` as the view: one region for the plan change, one for the inventory barrier, one for Stripe, colored by the deadline. `chart-landing.cfg` is one scheduler and nothing else.

Before the fix of F1, it found `DeadlineStopsProviderEffect` broken in 12 steps. That path let the deadline pass between the Stripe read of `prepareFreeChange` and the publishing compare-and-set, so a preparation could be published after `effectiveAt`. Such a preparation now aborts at the admission's deadline check. On the current model, plain TLC reports no error on `chart-landing.cfg`, with 209 distinct states. The other configurations are too large to chart, and `/statechart` checks them only.

## Real bug or modeling error

Node runs other requests at every `await`, and the cron, webhooks and API calls run in other processes, so any order of round trips across those callers can happen. A step order is a modeling error when the code cannot produce it, for example one round trip split in two. Replay the counterexample through the Vitest harness (`pnpm --filter @antelopejs/dms-saas test:unit`), one action per step:

- Hold a call inside the plan change policy's `validatePlanChange`, inside a Stripe stub, or before a `TenantSubscriptionModel.prototype.findOne` with a promise you resolve later, then run the other caller. `test/guarded-free-downgrade.test.ts` has examples.
- Inject a fault by making a stub throw, or by mocking `@antelopejs/interface-dms/tenant-lifecycle` so that one caller's `resumeTenantLifecycleAdmission` throws.

Assert only what a caller observes: the answer, the row's `guardedPlanChange`, `observeTenantLifecycle`, `isTenantSubscriptionBlocked`, and the Stripe calls. If the replay does not reproduce the finding, treat the model as wrong until you show it is not.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `file.ts:NN` comment on each condition and update its line, then run both configurations.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `CONFIGS` in `check.mjs` once a replay confirms the fix. The two fix candidates in the last section show what `check.mjs` prints then. A new finding goes into `CONFIGS` with its counterexample length for each configuration, and into this file with its replay.
- When you change the bounds of a `.ci.cfg`, rerun the scratch changes below on it. The CI configuration must still catch each one.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

All paths are under `packages/dms-saas/src/`.

| Model action | Code |
| --- | --- |
| `PrepRead`, `PrepCheck`, `PrepCas` | `prepareFreeChange` (`plan-changes/guarded-free.ts:64-106`), `prepareGuardedPlanChange` (`plan-changes/guarded-state.ts:36-65`) |
| `DrainObserve`, `DrainRead`, `Pause`, `DrainAgain`, `DrainTimesOut` | `drainPlanInventory` (`plan-changes/inventory-barrier.ts:22-56`), with dms `pauseTenantLifecycleAdmission` |
| `Release` in every caller | `releasePlanInventory` (inventory-barrier.ts:59-64), with dms `resumeTenantLifecycleAdmission` |
| `ValidatePasses`, `ValidateRefuses`, `AdmitCas`, `Catch*`, `EmitRelease`, `EmitSchedule`, `ScheduleCheck`, `ConfirmSchedule` | `scheduleGuardedFreeChange` (guarded-free.ts:116-179), `admitGuardedProviderEffect`, `abortGuardedPreparation`, `completeGuardedAbort`, `confirmGuardedSchedule` (guarded-state.ts) |
| `Cancel*`, `ConfirmCancel` | `cancelGuardedFreeChange` (guarded-free.ts:182-214), `admitGuardedCancellation`, `confirmGuardedCancellation` (guarded-state.ts:140-170) |
| `ReconcileRead`, `Rec*`, `Land*` | `reconcileGuardedFreeChange`, `recoverInventoryPreparation`, `validateAndCommitFree`, `recordBlocked`, `completeFreeActivation` (`plan-changes/guarded-landing.ts`), called by `crons/reconcile-guarded-downgrades.ts` and by `applyPendingFreePlanOnCancellation` (`plan-changes/deferred.ts:316-336`) from the Stripe `customer.subscription.deleted` webhook (`stripe/webhook-handlers.ts:293-303`) |
| `IsBlocked` | `isGuardedPlanChangeBlocked` (guarded-state.ts:8-19), read by `auth/subscription-access-gate.ts` and `stripe/webhook-shared.ts:55-77` |
| `Applies`, `Cas` | `TenantSubscriptionModel.mutateRevision` (`packages/interface-dms-saas/src/db/models/tenantSubscriptions.model.ts:52-67`) and `compareAndSet` (guarded-state.ts:21-33) |
| `OrdinaryWrite` | `TenantSubscriptionModel.update` (tenantSubscriptions.model.ts:79-100), refused while `domainTransition` is set |
| `WriterAdmit`, `WriterFinishes`, `WriterFails`, `Close` | dms `runTenantLifecycleOperation` and `closeTenantLifecycleAdmission`, as proved by `formal-tenant-lifecycle`; `crons/hard-delete-cancelled.ts` closes |
| `ProviderLands`, `ProviderLost`, `StripePeriodEnds` | Stripe: a request lands whatever its caller does next, and at the period end Stripe cancels if asked to, else renews |

The sync commit is `c6e7c1c8` on AntelopeJS/dms-saas `main`.

## Bounds and what is left out

The bounds are in the table above. Each scheduler runs one operation with one barrier, each reconciler one reconciliation, and the canceller one cancellation. The deadline and the preparation timer each pass once. Some behaviours start with no deletion to come, so a closure cannot excuse a barrier left held. A pass covers these bounds only. Two concurrent landings need two reconcilers, which only the full `Faults` configuration has.

The model leaves out:

- `deletionStartedAt`. `compareAndSet` refuses once a subscription deletion started (guarded-state.ts:26), and `beginCancelledDeletion` refuses while a guarded change exists. The tenant deletion here only closes the lifecycle row.
- `pendingPlanId`, `pendingPlanChangeAt` and `domainTransition` beyond one flag. They are written in the same compare-and-sets as the phase. `transition` stands for `domainTransition` being set, which is what refuses an ordinary write.
- what validation decides, and the Free plan's own checks. Validation passes, refuses, or throws, as a free choice.
- notifications and lifecycle outbox deliveries (`notifyBlocked`, `dispatchWorkspaceLifecycle`). They have durable identities and change no field the rules read.
- the subscription's `status`. `completeFreeActivation` keeps a payment suspension, and `GetPlanChangeActivation` reads it. Neither moves the phase.
- Stripe's answer details. A confirmation is right when Stripe holds the asked state for the same period, which the model reduces to `cancelAtEnd` and `renewed`.
- a barrier the row does not name. Only `drainPlanInventory` calls `pauseTenantLifecycleAdmission` in this repository, so a drain meets another barrier (barrier.ts:42-43) only after F2 leaves one held, and no drain runs after that within the bounds. A seeded drain that takes that barrier for its own reaches the same states as the model in every configuration, so no rule can catch it. `InventoryFrozen` would, once a drain reaches one.
- two concurrent preparations. A second `prepareGuardedPlanChange` fails on the first's row, and `Races` runs a second operation after the first ended.
- the real clock. `deadline` and `elapsed` are booleans that pass at any step, and the drain's 2 s wait is a free choice to poll again or give up.

## Confirm the check can fail

[seeded-breaks.md](seeded-breaks.md) lists one model edit per code change that each rule must catch, and the result of each in both configurations. Rerun them after you change the model or the bounds of a `.ci.cfg`.
