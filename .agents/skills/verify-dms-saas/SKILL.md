---
name: verify-dms-saas
description: "Drive the AntelopeJS dms-saas module (public registration and pricing, the plan catalogue and its gating, workspace settings, the platform owner's back office, billing rules and the Stripe webhook) the way visitors, workspace owners and the platform owner do, inside a DMS with free ports and its own MongoDB database, with placeholder Stripe keys, and report a verdict with evidence. Use to prove a change to AntelopeJS/dms-saas works before merge, to verify a PR, or to check that the guarded-plan-change formal check is caught."
---

# Verify dms-saas

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it where its kind lives, describe it in its feature file, and run it: a browser journey to `e2e/journeys/<feature>.mjs`, an HTTP or command-line journey as a test of `packages/dms-saas/test/<feature>.journeys.test.ts`.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of the repository root, the one the `e2e/` suite imports its kit from. Run it with Node 24 after `pnpm install`, from the repository root:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

The `@antelopejs/dms` of `packages/dms-saas` is the DMS the playground runs, and its `dms-control` predates the `journeys` key of `verify.config.ts`: do not run that one.

## Launch

```bash
RUN=$($C up --prepare --base origin/main)   # installs, builds, starts; prints the run folder
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, then `pnpm e2e:build`, which builds the interface and the module, links the playground's `node_modules` to `packages/dms-saas/node_modules`, and builds the playground's fixture module. `up` reads the playground from `verify.config.ts` (`e2e/playground/`: the DMS, the api, MongoDB, auth, local file storage and mail modules, the module under verification as a `local` source at `packages/dms-saas`, and a fixture module of its own) and starts an isolated DMS on free ports with its own `verify_<run>` databases.

The module runs with placeholder Stripe keys (`sk_test_placeholder`), so it makes no Stripe call and registration applies the `none` card policy. Everything that needs a live Stripe is listed under Not driven, with the refusal the module gives without a key where there is one.

The fixture module (`e2e/playground/src/fixture.ts`, under `/verify-saas`) serves what a journey cannot do over the module's own HTTP API: an account without a workspace and its tenant assignment token, the provisioning payloads a `TENANT_BEING_PROVISIONED` listener received, the effective permissions of a user of a workspace, a subscription written the way a paid flow leaves it, the processing records of the Stripe webhook, and the billing reads of `@antelopejs/interface-dms-saas`.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/main   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" plans [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`), its journeys and a Coverage table; the journeys are in `e2e/journeys/<feature>.mjs` and `e2e/journeys/parts/` (the `journeys` folder of `verify.config.ts`), with the helpers they share in `e2e/saas.mjs` and `e2e/guard.mjs` (environment loss).
- A journey may set `tag` (Playwright tags such as `"@smoke"`, the set a pull request runs) and `knownFailures`, which maps the name of each check that fails today to the finding that makes it fail. A listed check that fails is `known` and does not fail the journey. A listed check that passes is `fixed` and fails the journey until the entry is removed. `result.json` records each check's verdict (`pass`, `fail`, `known`, `fixed`).
- The HTTP and command-line journeys run as the Vitest integration tests `packages/dms-saas/test/*.journeys.test.ts`: `pnpm --filter @antelopejs/dms-saas test:journeys` starts one run, moves each test onto a fresh database with an onboarded administrator, and stops the run after; CI runs all of them wherever it runs the browser journeys, a ready pull request included.
- The browser journeys run as the Playwright suite of `e2e/`, which CI runs (`@smoke` on a ready pull request; every journey in the merge queue, on a manual run, under the `ci:full` label and on two shards nightly; a draft runs none): `pnpm e2e` prepares and starts a run, runs every journey on it and stops it; `pnpm e2e -g <feature or journey id>` or `--grep @smoke` narrows it. `DMS_E2E_PREBUILT=1` skips the prepare commands, and `DMS_E2E_RUN=$RUN` drives a run you started with `up`, which it leaves running. Failed journeys keep their evidence under the run, and the report attaches each failed step's screenshot and ARIA snapshot and the backend log.
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it. It reads every mutation back through a second view: the API, another account, a reload, a backend restart or the fixture.
- `withConfig(ctx, { VERIFY_SAAS_*: … }, body)` restarts the backend with module options set (`ADMISSION`, `PAYMENT_METHOD`, `SCREENS_OFF`, `DEFAULT_PLAN`, `PREVIEW_TTL`, `REPORTING_CURRENCY`, `STRIPE_SECRET_KEY`, `WEBHOOK_SECRET`; see `e2e/playground/antelope.config.ts`) and restarts it again without them; `refusedAtStart` tries a configuration the module must refuse.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

State the verdict in your own reply. Start it with the result, then the doors, then what each rule below showed.

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`. For each of them, also run its journey integration tests: `pnpm --filter @antelopejs/dms-saas test:journeys <feature>` (every one with no filter). Run every feature instead, smoke first, when the diff touches a shared file and before a release. The shared files are a `package.json` or `pnpm-lock.yaml` of the root, `packages/dms-saas`, `packages/dms-saas/frontend-vue` or `packages/interface-dms-saas`, `packages/interface-dms-saas/src/**`, `tsconfig.base.json`, `packages/dms-saas/tsconfig.json`, this skill's `verify.config.ts`, and `e2e/playground/**`. `plan` does not list them yet.
2. **Unmapped surface fails the verdict.** User-facing code is `packages/dms-saas/src/**`, `frontend-vue/**`, `skills/**`, `package.json`, and `packages/interface-dms-saas/src/**` and `package.json`, tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey and every journey integration test of a feature in `run` must have run and passed.** A feature whose `dms-control journey` runs nothing still has its integration tests to run. A journey that ends `NOT VERIFIED` (the backend or the dashboard went away) is not a result: bring the run down, start a new one and rerun that journey before you write the verdict. Only a journey that ran to the end counts. A known finding is listed in its journey's `knownFailures` (see the feature files' Gotchas): its check reads `known` and does not fail the journey. Name each one in the reply as a note.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** `formal-guarded-plan-change` covers the guarded paid-to-Free plan change (`plan-changes/guarded-*.ts`, `inventory-barrier.ts`, `pending-target.ts`, `deferred.ts`, the guarded-downgrade cron, the webhook handlers, the subscription access gate and the subscription model). `$C formal "$RUN"` runs it when the diff touches a covered file or the check; a finding fails the verdict only when the behaviour of the covered code changed. It needs Docker or Java for TLC. `formal-workspace-creation-gate` covers the workspace creation gate (`operator-actions/lifecycle-outbox.ts`, `operator-actions/db/lifecycle-delivery.*`, `workspaces/provisioning*.ts`, the lifecycle cron and the startup reconcile in `hooks/register.ts`) the same way.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

A new push voids the verdict: verify again on the new head. Nothing is posted to GitHub.

## Gotchas

- Run `pnpm exec lefthook install` before `up`: the module installs of a run call `lefthook install` in parallel and fail when the hooks are out of sync.
- Every dashboard page renders on the server and hydrates after `load`; `guard.mjs` waits for the sign-in form to hydrate.
- A plan with no permissions leaves its owner without any page (403): the smoke journey publishes a plan holding every permission of the editor's tree.
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check.
- Known finding on `main`, listed in its journey's `knownFailures` and explained in its feature file: `public/invitation-only-closes-every-registration-route` (after a backend restart into invitation-only, `/register` renders the 500 page).

## Not driven

List these as not verified in every verdict:

- everything that calls Stripe: checkout, plan changes and upgrades, cancellation, refunds, credit notes, balance credits, the next invoice, the payment method, the billing portal, plan sync to Stripe products and prices, and the handlers of webhook events that read Stripe back;
- the module's crons (suspension at 01:00, complimentary end at 02:00, deletion at 04:30, the per-minute guarded downgrade, the 15-minute directory and segment passes): the harness cannot advance the module's clock;
- the data export archive and its e-mailed link;
- OAuth sign-in and the frontend server's `/auth/establish` exchange;
- the client-rendered wording of the pricing page (call-to-action text, Monthly/Yearly switch, Compare plans, FAQ) and of the dashboard tables;
- the features catalogue page and plan migrations beyond their start (blocked by a known finding);
- invoice line item providers, plan change policies and tenant lifecycle consumers of the interface, which need invoices and transitions the harness cannot produce;
- the last-platform-admin demotion rule, which the API cannot reach because the acting admin always counts as another admin.

## Feature map

[features/README.md](features/README.md).
