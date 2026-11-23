# Seeded breaks of formal-workspace-creation-gate

On a scratch copy of this folder outside the repository, apply one model edit at a time to `WorkspaceCreationGate.tla` and run TLC on `Healthy.cfg` (or `node check.mjs` from a scratch folder inside the repository so the runner resolves). Each edit mirrors the code change in the first column. These ran at the sync commit. A caught change breaks one rule in `Healthy`; the trace length varies with the rule TLC reports first.

| Scratch change in the code, and the model edit | Rule | `Healthy`, trace states |
| --- | --- | --- |
| `claim-skips-revision`: model.ts:97-111 `claim` writes without the observed revision: `Claim` drops `row.rev = snap[a].rev` | `SingleClaimant` | BROKEN, 9 |
| `claim-skips-claimable`: model.ts:99 `claim` drops `isLifecycleDeliveryClaimable`: `Claim` drops `Claimable(snap[a])` | `SingleClaimant` | BROKEN, 10 |
| `transition-skips-revision`: model.ts:66 `mutate` without the observed revision: `TrCas` always applies | `OneDecision` | BROKEN, 16 |
| `transition-skips-state-check`: model.ts:64-65 drops the refusal of a changed state: `TrRead` never throws | `OneDecision` | BROKEN, 16 |
| `cancel-skips-state-read`: lifecycle-outbox.ts:294-299 drops the committed refusal: `CancelRead` cancels any state | `OneDecision` | BROKEN, 16 |
| `consume-skips-invoice`: lifecycle-outbox.ts:186-193 does not read the invoice: `ConsInvoice` always commits | `CommitNeedsPayment` | BROKEN, 11 |
| `markfailed-without-revision`: model.ts:145 `markFailed` writes without the observed revision: `MarkFailCas` always applies | `SucceededFinal` | BROKEN, 15 |
| `markfailed-skips-succeeded`: model.ts:143 drops the succeeded check: `MarkFailRead` only tests the claim | `SucceededFinal` | BROKEN, 15 |
| `claim-guard-removed`: model.ts:31 drops the `preparing` guard: `GuardPreparing = FALSE` | `NoClaimOfHeldGate` | `Before261.cfg` and `RetryOnly.cfg` record it as a finding |
| `retry-removed`: model.ts:56 one attempt: `Attempts = 1` | `DecisionNotLost` | `Before261.cfg` and `ClaimGuardOnly.cfg` record it as a finding |

Three scratch changes are not caught, each for a reason in SKILL.md:

- `markfailed-skips-claim-owner`: model.ts:144 drops the claim comparison. With no lease and no crash, only the holder can write a `running` row, so it changes nothing.
- `consume-runs-on-preparing`: lifecycle-outbox.ts:178-180 drops the refusal of a `preparing` gate in the consumer. With the claim guard on, no claim reaches a `preparing` gate. It is defence in depth, and `Before261` and `RetryOnly` run without the guard.
- `markok-skips-latest`: model.ts:135-138 does not throw when `markSucceeded` loses its compare-and-set to a writer that did not succeed. It is error-path accounting that no rule reads.

With the edits dropped, `check.mjs` exits 0.
