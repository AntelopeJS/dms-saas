---
name: formal-workspace-creation-gate
description: TLA+ model of the workspace creation gate of @antelopejs/dms-saas (the registration's prepare and cancel, the lifecycle cron's claim, markFailed and commit, and the registration's own delivery, all compare-and-sets on one row), checked with TLC. Use when a change touches a file in its coverage record, or when a change to the creation gate, its claim, or the lifecycle delivery needs proof that no decision is lost and no gate is left stuck.
---

# Formal check: workspace creation gate

A workspace registration persists one row, its creation gate, in `saas_lifecycle_deliveries` (consumer `$workspace-created`). The row carries two things: the registration's decision (`provisioningState`: `preparing`, then `awaiting_payment`, then `committed`, or `cancelled`) and the delivery's own state (`status`: `pending`, `running` while a claim holds it, `failed`, `succeeded`). The registration, the lifecycle cron (every 5 minutes, and once at startup), and the registration's own delivery all write that row. Every write is one compare-and-set on the row's `revision`, so a caller acting on a stale read changes nothing, and a claim moves the revision without deciding anything.

The model treats each database round trip as one step. TLC checks every order of those steps across the registration, two cron ticks and an invoice that gets paid elsewhere, within the bounds below. The promise it checks is that the registration's decision is never lost to a claim, that no gate stays `preparing` or `running` once everyone stopped, and that no tick claims a gate its registration still holds.

- `WorkspaceCreationGate.tla` holds the whole model. Each condition carries a `file.ts:NN` comment; its header says what `model` and `outbox` stand for.
- `Healthy.cfg` is the code of today. `Before261.cfg`, `ClaimGuardOnly.cfg` and `RetryOnly.cfg` are the code before AntelopeJS/dms-saas#261 and each half of that fix alone, and each must break (see the findings). `ThreeTicks.cfg` is `Healthy` with a third tick, past its bound.
- `check.mjs` runs the five configurations in that order.

## Run it

From the repository root, with Node 24 and `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`):

```sh
node .agents/skills/formal-workspace-creation-gate/check.mjs
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. The run takes about 13 s with Docker, and CI runs it on every push through the `formal` job.

| Configuration | Ticks, `GuardPreparing`, `Attempts` | States | What it is |
| --- | --- | --- | --- |
| `Healthy` | 2, TRUE, 5 | 3,344 | the code of today |
| `Before261` | 2, FALSE, 1 | 6,872 | the code before #261 |
| `ClaimGuardOnly` | 2, TRUE, 1 | 2,362 | #261's claim guard without its retry |
| `RetryOnly` | 2, FALSE, 5 | 10,940 | #261's retry without its claim guard |
| `ThreeTicks` | 3, TRUE, 5 | 38,332 | `Healthy` past the retry budget |

The states count the run of the rules that hold.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path. The run stops at the first configuration that changed.
- Exit 2 means TLC or Java could not run.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints as lowercase `holds`, a recorded finding as `finding`.

## When to run it

Run it when a change touches a file in the coverage record below, or this folder. A changed rule (exit 1) means the change broke a promise, or the model no longer describes the code. If `Healthy` breaks, the change reopens a race. If a finding of `Before261`, `ClaimGuardOnly` or `RetryOnly` reads `HOLDS`, the model lost the ability to see the race #261 fixed, so fix the model.

## The rules

| Rule | Plain sentence | Harm when it breaks |
| --- | --- | --- |
| `DecisionNotLost` | A decision (prepare, cancel, commit) never gives up while the state it wants to leave is still the row's: a claim or its outcome moved the revision, and nothing decided. | The registration returns 500 "Workspace provisioning not-applied" for a workspace it kept, or a declined card's workspace is not cancelled. |
| `NoStuckGate` | Once every actor stopped, the gate is neither `preparing` nor `running`. | A `preparing` gate is never recovered, and every cron tick and restart logs a delivery failure for it. A `running` gate holds its lease for 10 minutes and is not delivered. |
| `NoClaimOfHeldGate` | No claim applies to a gate that is still `preparing`. | The tick moves the revision under the registration's compare-and-set, so the registration's decision fails. |
| `OneDecision` | A cancelled gate is never committed, and a committed gate is never cancelled. | A workspace of a declined card opens, or a paid one is rolled back. |
| `CommitNeedsPayment` | A gate commits only once its invoice is paid. | A workspace opens without paying. |
| `SucceededFinal` | A succeeded delivery stays succeeded. | Failure accounting overwrites a settled receipt and the delivery runs again. |
| `SingleClaimant` | No two actors are inside one delivery attempt. | The consumer runs twice for one delivery. |

`TypeOK` holds too. The first three rules are the promise of the task that asked for this model, the rest guard the code around them. `NoStuckGate` reads at quiescence, with the 10-minute lease out of the model: a `running` row is never retaken, so a claim holder that leaves without recording its outcome leaves the gate `running` for good.

## Findings

The check holds on the current code. It records findings on the code before the fix, so the check stays able to fail on it. Each was replayed on the real code with `test/registration-lifecycle-tick.test.ts`, with the code of the configuration put back in `lifecycle-delivery.model.ts` as a scratch change.

- **`Before261`: `NoClaimOfHeldGate` (4 states), `DecisionNotLost` (7), `NoStuckGate` (11).** The model's counterexample for `DecisionNotLost`: the registration inserts the gate and reads it for its compare-and-set; a tick reads the gate (it is `pending`, and `preparing` does not stop the claim), claims it, and moves the revision; the registration's compare-and-set fails, `transitionProvisioning` throws `Workspace provisioning not-applied`, and the registration keeps the workspace and stops. The tick's consumer finds `preparing`, throws, and `markFailed` leaves it `failed`. The gate stays `preparing`, and every later tick claims it, fails and logs again. The replay with both halves reverted fails all three tests of the file: the workspace is not provisioned, the tick logs the failure four times, and the declined card's cancel throws `not-applied` instead of the decline.
- **`ClaimGuardOnly`: `DecisionNotLost` (11).** Without the retry, the card-decline cancel reads the gate in `awaiting_payment`, a tick claims it, and the cancel's compare-and-set fails. The replay with `PROVISIONING_ATTEMPTS = 1` fails the declined-card test alone.
- **`RetryOnly`: `NoClaimOfHeldGate` (4), `NoStuckGate` (14).** With the retry and no claim guard, the registration's decision survives, but a tick that claimed the `preparing` gate loses its `markFailed` to the registration's write, silently, and the gate stays `running`. The replay without the claim guard fails the no-delivery-failure test. The `running` end state itself was not replayed: the file asserts only the log.
- **`ThreeTicks`: `DecisionNotLost` (31), a bound, not a defect.** Each lost compare-and-set means another writer committed, and one delivery attempt writes twice (claim, outcome), so `PROVISIONING_ATTEMPTS = 5` covers two overlapping attempts. A third tick finishing a whole attempt inside each of the retry's windows exhausts it. The cron fires every 5 minutes and a window is one database round trip, so the model gives that no real path. The configuration keeps the limit visible, and a lower `PROVISIONING_ATTEMPTS` moves it.

## Real bug or modeling error

Node runs other requests at every `await`, and the cron and the registration run in the same process and in other nodes, so any order of round trips can happen. A step order is a modeling error when the code cannot produce it, for example one round trip split in two. Replay a counterexample through the Vitest harness (`pnpm --filter @antelopejs/dms-saas test:unit`), one action per step: `tickBetweenTransitionReadAndWrite` in `test/registration-lifecycle-tick.test.ts` runs a real tick between the registration's read and write of its gate, which is the shape of every counterexample here. Assert only what a caller observes: the answer, the gate's `provisioningState`, `isWorkspaceProvisioningCommitted`, and the logged errors. If the replay does not reproduce the finding, treat the model as wrong until you show it is not.

Read each TLC result with the pstack `/statechart` skill. Work on a copy of the `.tla` files and the configuration in a scratch folder outside the repo, since it writes its output next to its input.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `file.ts:NN` comment on each condition and update its line, then run the check.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `CONFIGS` in `check.mjs` once a replay confirms the fix. A new finding goes into `CONFIGS` with its counterexample length, and into this file with its replay.
- After you change the model, rerun the scratch changes of [seeded-breaks.md](seeded-breaks.md): `Healthy` must still catch each.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

All paths are under `packages/dms-saas/src/`.

| Model action | Code |
| --- | --- |
| `Insert` | `beginWorkspaceCreation` (`operator-actions/lifecycle-outbox.ts:251-264`), called at `workspaces/provisioning.ts:452` |
| `Choose`, `CancelRead` | `cancelWorkspaceCreated` (lifecycle-outbox.ts:290-305), called by the rollback (`workspaces/provisioning-rollback.ts:22-29`) and by `settleSubscriptionPayment` on a card decline (`workspaces/provisioning.ts:366-375`) |
| `Pay` | `settleSubscriptionPayment` (provisioning.ts:344-377), with `prepareWorkspaceCreated` (lifecycle-outbox.ts:267-277) |
| `TrRead`, `TrCas` | `transitionProvisioning` (`operator-actions/db/lifecycle-delivery.model.ts:47-74`, `PROVISIONING_ATTEMPTS` at line 14) |
| `TickRead` | `findReplayable` (model.ts:81-90), `isLifecycleDeliveryClaimable` (model.ts:27-35), `reconcileWorkspaceLifecycleDeliveries` (lifecycle-outbox.ts:367-389), called by `crons/reconcile-workspace-lifecycle.ts` and at startup by `hooks/register.ts` |
| `DeliverRead` | `deliverWorkspaceCreated` (lifecycle-outbox.ts:308-319), `deliverOne` (lifecycle-outbox.ts:343-354) |
| `Claim` | `claim` (model.ts:97-111) |
| `ConsGet`, `ConsInvoice` | `consumeCreationIntent` (lifecycle-outbox.ts:173-202) |
| `MarkOkRead`, `MarkOkCas` | `markSucceeded` (model.ts:114-138), `invokeConsumer` (lifecycle-outbox.ts:321-341) |
| `MarkFailRead`, `MarkFailCas` | `markFailed` (model.ts:141-154), swallowed at lifecycle-outbox.ts:338 |
| `InvoicePaidElsewhere` | Stripe: the customer or an invoice retry pays the open invoice |

The row model is `operator-actions/db/lifecycle-delivery.table.ts`. The sync commit is `280ddb1c` on AntelopeJS/dms-saas `next`.

## Bounds and what is left out

The bounds are in the table above: one registration, two cron ticks, one gate. Each actor runs one attempt, and the registration takes one path (prepare then pay or decline, or an early rollback).

The model leaves out:

- the 10-minute lease (`claimExpiresAt`) and crashes. A `running` gate is never retaken, and an actor never dies between two steps. A claim holder that crashes leaves the gate `running` until the lease expires, and the next tick retakes it. The `markfailed-skips-claim-owner` scratch change below is not caught for that reason.
- database faults and `unknown` outcomes (`mutate` answering `unknown`). They stop the loop and throw, the same as a lost compare-and-set at the last attempt.
- trials. A trial has no invoice, so the consumer skips the payment check (lifecycle-outbox.ts:186-193).
- a deleted tenant (lifecycle-outbox.ts:183-184) and the other lifecycle consumers of the same transition, which have their own deliveries.
- what the registration's earlier steps do. It reaches the gate as `prepare`, `cancel`, or nothing.
- the gate's other columns (`attemptCount`, `receiptId`, timestamps). They change in the same compare-and-sets and no rule reads them.
- the real clock. A tick starts at any step.
