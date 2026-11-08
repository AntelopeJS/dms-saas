# Seeded breaks of formal-guarded-plan-change

On a scratch copy of this folder, inside the repository so the runner resolves, apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. These ran at the sync commit. The run stops at the first configuration that changed, and a `BROKEN` line is the rule, since its trace length varies.

| Scratch change in the code, and the model edit | Rule | CI configuration (two runs) | Full configuration (one run) |
| --- | --- | --- | --- |
| `admit-without-revision`: state.ts:28 mutateRevision without expectedRevision: AdmitCas lands on any revision | `NoStaleProviderEffect` | BROKEN NoStaleProviderEffect, exit=1 (Healthy.ci) x2 | BROKEN NoStaleProviderEffect, exit=1 (Healthy) |
| `emit-before-admission`: free.ts:139-160 Stripe called before admitGuardedProviderEffect: ValidatePasses goes to emitRelease | `NoStaleProviderEffect` | BROKEN NoStaleProviderEffect, exit=1 (Healthy.ci) x2 | BROKEN NoStaleProviderEffect, exit=1 (Healthy) |
| `cancel-skips-admission`: free.ts:194 admitGuardedCancellation dropped: CancelRead goes to cancelEmit | `NoStaleProviderEffect` | BROKEN NoStaleProviderEffect, exit=1 (Healthy.ci) x2 | BROKEN NoStaleProviderEffect, exit=1 (Healthy) |
| `drain-ignores-writers`: barrier.ts:41 drops activeAttemptIds.length: DrainRead treats the observation as empty | `InventoryFrozen` | BROKEN InventoryFrozen, exit=1 (Healthy.ci) x2 | BROKEN InventoryFrozen, exit=1 (Healthy) |
| `drain-without-barrier`: barrier.ts:40-50 an empty observation with no barrier counts as drained | `InventoryFrozen` | BROKEN InventoryFrozen, exit=1 (Healthy.ci) x2 | BROKEN InventoryFrozen, exit=1 (Healthy) |
| `writer-ignores-barrier`: dms model.admit drops the 409 (environment): WriterAdmit ignores the barrier | `InventoryFrozen` | BROKEN InventoryFrozen, exit=1 (Healthy.ci) x2 | BROKEN InventoryFrozen, exit=1 (Healthy) |
| `prepare-overwrites-change`: state.ts:41-47 prepareGuardedPlanChange drops the existing-transition refusal | `OneEnd` | BROKEN OneEnd, exit=1 (Races.ci) x2 | BROKEN OneEnd, exit=1 (Healthy) |
| `complete-abort-without-revision`: state.ts:82-93 completeGuardedAbort writes without expectedRevision, from the canceller | `OneEnd` | BROKEN OneEnd, exit=1 (Healthy.ci) x2 | BROKEN OneEnd, exit=1 (Healthy) |
| `gate-blocks-early`: state.ts:15-18 the effectiveAt test compares the wrong way (>=): the gate closes before the deadline | `NoBlockBeforeDeadline` | BROKEN NoBlockBeforeDeadline, exit=1 (Healthy.ci) x2 | BROKEN NoBlockBeforeDeadline, exit=1 (Healthy) |
| `gate-ignores-deadline`: state.ts:15-18 isGuardedPlanChangeBlocked drops the effectiveAt test | `DeadlineBlocks` | BROKEN DeadlineBlocks, exit=1 (Healthy.ci) x2 | BROKEN DeadlineBlocks, exit=1 (Healthy) |
| `gate-blocks-aborting`: state.ts:14 isGuardedPlanChangeBlocked drops the aborting exemption | `AbortingKeepsAccess` | BROKEN AbortingKeepsAccess, exit=1 (Healthy.ci) x2 | BROKEN AbortingKeepsAccess, exit=1 (Healthy) |
| `cancel-ignores-deadline`: state.ts:140 admitGuardedCancellation drops its deadline check | `DeadlineBlocks` | BROKEN DeadlineBlocks, exit=1 (Healthy.ci) x2 | BROKEN DeadlineBlocks, exit=1 (Healthy) |
| `landing-skips-stripe-check`: landing.ts:202-206 the landing does not read Stripe | `LandsOnlyWhenCancelled` | BROKEN LandsOnlyWhenCancelled, exit=1 (Healthy.ci) x2 | BROKEN LandsOnlyWhenCancelled, exit=1 (Healthy) |
| `landing-ignores-deadline`: landing.ts:184 the landing does not wait for effectiveAt | `NoBlockBeforeDeadline` | BROKEN NoBlockBeforeDeadline, exit=1 (Healthy.ci) x2 | BROKEN NoBlockBeforeDeadline, exit=1 (Healthy) |
| `catch-skips-release`: free.ts:148 the scheduler catch drops releasePlanInventory | `AdmissionResumes` | BROKEN AdmissionResumes, exit=1 (Healthy.ci) x2 | BROKEN AdmissionResumes, exit=1 (Healthy) |
| `landing-finally-skips-release`: landing.ts:302-304 the finally drops releasePlanInventory | `AdmissionResumes` | BROKEN AdmissionResumes, exit=1 (Healthy.ci) x2 | BROKEN AdmissionResumes, exit=1 (Healthy) |
| `cron-aborting-skips-release`: landing.ts:138 recovery of an aborting change drops the release | `AdmissionResumes` | BROKEN AdmissionResumes, exit=1 (Faults.ci) x2 | BROKEN AdmissionResumes, exit=1 (Faults) |
| `fix-admit-checks-deadline`: fix candidate for dms-saas#206: admitGuardedProviderEffect refuses past effectiveAt | `DeadlineStopsProviderEffect` | HOLDS  DeadlineStopsProviderEffect (597155 states), exit=1 (Healthy.ci) x2 | HOLDS  DeadlineStopsProviderEffect (39708133 states), exit=1 (Healthy) |
| `fix-cancel-compares-operation`: fix candidate for dms-saas#207: the canceller completes only its own abort | `AdmissionResumes` | HOLDS  AdmissionResumes (93404 states), exit=1 (Races.ci) x2 | HOLDS  AdmissionResumes (1320750 states), exit=1 (Races) |
| `landing-completes-any`: landing.ts:306 the landing completes an activation it did not write, which reverts the fix of dms-saas#209 | `AdmissionResumes` | no change, exit=0 (Races.ci) x2 | BROKEN AdmissionResumes, exit=1 (Faults) |

Every scratch change in the table but `landing-completes-any` exits 1 in both configurations. `landing-completes-any` changes nothing in CI, because the CI configuration has one reconciler and the break needs two concurrent landings. Each fix candidate makes its finding `HOLDS`. The `cron-aborting-skips-release` and `landing-completes-any` rows ran at the fix of dms-saas#209.

One scratch change is not caught, which is why SKILL.md lists a barrier the row does not name under what the model leaves out. `drain-takes-other-barrier`: barrier.ts:42-43 drains under another barrier as under its own (DrainRead takes any observed barrier for its own). It exits 0 in both configurations, with the model's own state counts: 597,155, 100,872 and 80,112 in CI, 39,708,133, 15,387,242 and 1,115,272 in full, at the fixes of dms-saas#206 and dms-saas#209.

With the edits dropped, both configurations exit 0.
