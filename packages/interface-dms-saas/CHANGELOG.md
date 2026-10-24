# Changelog

## v0.6.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.6.0...v0.6.1)

### 🚀 Enhancements

- **platform:** Adopt the DMS page toolbar on the dashboard and plan migration detail ([#112](https://github.com/AntelopeJS/dms-saas/pull/112))
- **platform:** Declare the plan and segment create forms with kind: "create" ([#128](https://github.com/AntelopeJS/dms-saas/pull/128))
- **settings:** Offer the module default on the billing rules ([#136](https://github.com/AntelopeJS/dms-saas/pull/136))
- Provision workspaces through DMS ProvisionTenant ([#137](https://github.com/AntelopeJS/dms-saas/pull/137))

### 🩹 Fixes

- **auth:** Shape a role preview as an ordinary member's permissions ([#113](https://github.com/AntelopeJS/dms-saas/pull/113))
- **workspaces:** Drop the plan quick filter dms#370 refuses ([#127](https://github.com/AntelopeJS/dms-saas/pull/127), [#370](https://github.com/AntelopeJS/dms-saas/issues/370))
- **billing:** Show billing banners on every page, module area included ([#122](https://github.com/AntelopeJS/dms-saas/pull/122))
- **billing:** Churn on first compute, invoice period hydration, lifecycle docs ([#108](https://github.com/AntelopeJS/dms-saas/pull/108))
- **segments:** Normalise workspace MRR like the dashboard ([#114](https://github.com/AntelopeJS/dms-saas/pull/114))
- **saas:** Surface Stripe failures and align plan counters ([#111](https://github.com/AntelopeJS/dms-saas/pull/111))
- **saas:** Plan catalogue counters, Stripe sync warning and translated plan badges ([#123](https://github.com/AntelopeJS/dms-saas/pull/123))
- **saas:** Workspace Billing page layout, DMS address input and hydrating invoice periods ([#124](https://github.com/AntelopeJS/dms-saas/pull/124))
- **saas:** Offer every plan for complimentary access without a customer type ([#115](https://github.com/AntelopeJS/dms-saas/pull/115))

### 💅 Refactors

- Attach the default plan on catalogue changes, not on a backfill ([#138](https://github.com/AntelopeJS/dms-saas/pull/138))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-saas 0.8.0 ([#135](https://github.com/AntelopeJS/dms-saas/pull/135))

### 📦 Build

- Run on dms 0.10, interface-dms 0.8 and interface-data-api 0.3 ([#134](https://github.com/AntelopeJS/dms-saas/pull/134))
- Run on @antelopejs/dms 0.11 and @antelopejs/dms-frontend 0.9 ([#139](https://github.com/AntelopeJS/dms-saas/pull/139))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.8.0 ([179ac40](https://github.com/AntelopeJS/dms-saas/commit/179ac40))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Maxime Westhoven ([@mwesto](http://github.com/mwesto))

## v0.6.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.5.1...v0.6.0)

### 🚀 Enhancements

- **config:** Default allowedRedirectHosts to the dashboard's host ([#129](https://github.com/AntelopeJS/dms-saas/pull/129))
- **invoice-line-items:** ⚠️  Always finalize with the lines available; expose the billing period ([#130](https://github.com/AntelopeJS/dms-saas/pull/130))
- **frontend:** The frontend registration as a pure function of the config, declared as dmsFrontend ([#132](https://github.com/AntelopeJS/dms-saas/pull/132))
- **saas:** ⚠️  Plan names, descriptions and badges as localized fields ([#133](https://github.com/AntelopeJS/dms-saas/pull/133))

### 🩹 Fixes

- **billing:** Show the refused plan change's violations and renew a spent card intent ([#119](https://github.com/AntelopeJS/dms-saas/pull/119))
- **billing:** Word a pending downgrade on the next invoice card and the review ([#120](https://github.com/AntelopeJS/dms-saas/pull/120))
- **frontend:** Run on @antelopejs/dms-frontend 0.7 ([#121](https://github.com/AntelopeJS/dms-saas/pull/121))
- **seats:** Read the member change kinds of MEMBER_BEING_CHANGED ([#131](https://github.com/AntelopeJS/dms-saas/pull/131))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.7.1 ([4f9e425](https://github.com/AntelopeJS/dms-saas/commit/4f9e425))
- **release:** @antelopejs/dms-saas v0.7.2 ([5dab061](https://github.com/AntelopeJS/dms-saas/commit/5dab061))
- **release:** @antelopejs/dms-saas v0.7.3 ([e70b2cc](https://github.com/AntelopeJS/dms-saas/commit/e70b2cc))
- **release:** @antelopejs/dms-saas v0.7.4 ([0341833](https://github.com/AntelopeJS/dms-saas/commit/0341833))

### ✅ Tests

- **invites:** Import ResolveInviteAvailability from its internal module ([#125](https://github.com/AntelopeJS/dms-saas/pull/125))

#### ⚠️ Breaking Changes

- **invoice-line-items:** ⚠️  Always finalize with the lines available; expose the billing period ([#130](https://github.com/AntelopeJS/dms-saas/pull/130))
- **saas:** ⚠️  Plan names, descriptions and badges as localized fields ([#133](https://github.com/AntelopeJS/dms-saas/pull/133))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.5.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.5.0...v0.5.1)

### 🚀 Enhancements

- **billing:** Guarded Free downgrade and durable invoice line recovery ([#116](https://github.com/AntelopeJS/dms-saas/pull/116))

### 🩹 Fixes

- **public:** Send sign-in links to the DMS sign-in page ([#84](https://github.com/AntelopeJS/dms-saas/pull/84))

### 📖 Documentation

- Clarify learning paths and illustrate real outcomes ([#110](https://github.com/AntelopeJS/dms-saas/pull/110))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.7.0 ([d4585ab](https://github.com/AntelopeJS/dms-saas/commit/d4585ab))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.5.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.4.1...v0.5.0)

### 🩹 Fixes

- **release:** Validate the packed workspace interface range ([#107](https://github.com/AntelopeJS/dms-saas/pull/107))

### 💅 Refactors

- **saas:** ⚠️  Rename workspace lifecycle API to tenant ([#109](https://github.com/AntelopeJS/dms-saas/pull/109))

### 📦 Build

- Include shipped frontend in contributor workspace ([#104](https://github.com/AntelopeJS/dms-saas/pull/104))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.6.1 ([ff000bb](https://github.com/AntelopeJS/dms-saas/commit/ff000bb))

#### ⚠️ Breaking Changes

- **saas:** ⚠️  Rename workspace lifecycle API to tenant ([#109](https://github.com/AntelopeJS/dms-saas/pull/109))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.4.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.4.0...v0.4.1)

### 🚀 Enhancements

- **billing:** Turn the free-workspaces-per-card rule off by default ([#87](https://github.com/AntelopeJS/dms-saas/pull/87))
- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#97](https://github.com/AntelopeJS/dms-saas/pull/97))
- Let a shared cache keep the public legal pages ([#100](https://github.com/AntelopeJS/dms-saas/pull/100))

### 🩹 Fixes

- **billing:** Stretch overview cards to their row height ([#90](https://github.com/AntelopeJS/dms-saas/pull/90))
- **saas:** Name row fields with {{row.X}} tokens for dms 0.8 ([#89](https://github.com/AntelopeJS/dms-saas/pull/89))
- **general:** Read the page again after a rename, so the glance shows the new name ([#98](https://github.com/AntelopeJS/dms-saas/pull/98))
- **frontend:** Leave the no-workspace page out of the history once its token is spent ([#99](https://github.com/AntelopeJS/dms-saas/pull/99))

### 💅 Refactors

- **plans:** List the table display beside the plan cards ([#85](https://github.com/AntelopeJS/dms-saas/pull/85))

### 📖 Documentation

- Move the README into a user guide, add screenshots and dms-saas skill ([#91](https://github.com/AntelopeJS/dms-saas/pull/91))
- Streamline agent guidance ([#101](https://github.com/AntelopeJS/dms-saas/pull/101))
- Establish the saas consumer reference ([#102](https://github.com/AntelopeJS/dms-saas/pull/102))
- Make dense guide sections easier to scan ([#103](https://github.com/AntelopeJS/dms-saas/pull/103))

### 📦 Build

- **saas:** Require @antelopejs/interface-dms-saas 0.4 ([#82](https://github.com/AntelopeJS/dms-saas/pull/82))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.5.0 ([9535de7](https://github.com/AntelopeJS/dms-saas/commit/9535de7))
- **release:** @antelopejs/dms-saas v0.5.1 ([4d93687](https://github.com/AntelopeJS/dms-saas/commit/4d93687))
- **release:** @antelopejs/dms-saas v0.6.0 ([1ed9de9](https://github.com/AntelopeJS/dms-saas/commit/1ed9de9))

### 🤖 CI

- Speed up pipeline ([#88](https://github.com/AntelopeJS/dms-saas/pull/88))

#### ⚠️ Breaking Changes

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#97](https://github.com/AntelopeJS/dms-saas/pull/97))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.4.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.3.0...v0.4.0)

### 🚀 Enhancements

- **saas:** ⚠️  V2 redesign on @antelopejs/dms 0.6 ([#81](https://github.com/AntelopeJS/dms-saas/pull/81))

### 📦 Build

- **saas:** Require @antelopejs/interface-dms-saas 0.3 ([#80](https://github.com/AntelopeJS/dms-saas/pull/80))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.4.0 ([f53455f](https://github.com/AntelopeJS/dms-saas/commit/f53455f))

#### ⚠️ Breaking Changes

- **saas:** ⚠️  V2 redesign on @antelopejs/dms 0.6 ([#81](https://github.com/AntelopeJS/dms-saas/pull/81))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.7...v0.3.0)

### 🚀 Enhancements

- **saas:** ⚠️  Store feature display names and tooltips as localized fields ([#79](https://github.com/AntelopeJS/dms-saas/pull/79))

### 🩹 Fixes

- **workspaces:** Make the card optional for free plans ([#74](https://github.com/AntelopeJS/dms-saas/pull/74))
- **billing:** Hide the upgrade and payment-method prompts on complimentary workspaces ([#75](https://github.com/AntelopeJS/dms-saas/pull/75))
- Translate billing statuses and automation labels, confirm plan downgrades ([#76](https://github.com/AntelopeJS/dms-saas/pull/76))

### 💅 Refactors

- **saas:** Namespace the plan cards display id ([#78](https://github.com/AntelopeJS/dms-saas/pull/78))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.12 ([5adb5a9](https://github.com/AntelopeJS/dms-saas/commit/5adb5a9))
- **playground:** Open module source ranges ([#73](https://github.com/AntelopeJS/dms-saas/pull/73))
- **release:** @antelopejs/dms-saas v0.3.13 ([13b6457](https://github.com/AntelopeJS/dms-saas/commit/13b6457))
- **release:** @antelopejs/dms-saas v0.3.14 ([ff98697](https://github.com/AntelopeJS/dms-saas/commit/ff98697))
- **release:** @antelopejs/dms-saas v0.3.15 ([9382d09](https://github.com/AntelopeJS/dms-saas/commit/9382d09))

#### ⚠️ Breaking Changes

- **saas:** ⚠️  Store feature display names and tooltips as localized fields ([#79](https://github.com/AntelopeJS/dms-saas/pull/79))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.7

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.6...v0.2.7)

### 🚀 Enhancements

- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#61](https://github.com/AntelopeJS/dms-saas/pull/61))
- **stripe:** Move to API version 2026-08-26.dahlia with stripe v22 ([#70](https://github.com/AntelopeJS/dms-saas/pull/70))

### 🩹 Fixes

- **frontend:** Send the payer email when confirming the card setup ([#60](https://github.com/AntelopeJS/dms-saas/pull/60))
- **billing:** Let owners resume or cancel an abandoned Stripe Checkout ([#69](https://github.com/AntelopeJS/dms-saas/pull/69))
- Make database-initialized handlers safe to replay ([#71](https://github.com/AntelopeJS/dms-saas/pull/71))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.9 ([51aee4f](https://github.com/AntelopeJS/dms-saas/commit/51aee4f))
- **release:** @antelopejs/dms-saas v0.3.10 ([6390f43](https://github.com/AntelopeJS/dms-saas/commit/6390f43))
- **release:** @antelopejs/dms-saas v0.3.11 ([e67529f](https://github.com/AntelopeJS/dms-saas/commit/e67529f))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.6

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.5...v0.2.6)

### 🚀 Enhancements

- **plans:** Disable the invite action at the seat limit and translate plan and billing texts ([#66](https://github.com/AntelopeJS/dms-saas/pull/66))

### 🩹 Fixes

- **plans:** Reconcile plans with Stripe once the database is initialised ([#67](https://github.com/AntelopeJS/dms-saas/pull/67))
- **billing:** Open Stripe Checkout on API 2025-08-27.basil and never strand a checkout ([#68](https://github.com/AntelopeJS/dms-saas/pull/68))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.6 ([47f60b8](https://github.com/AntelopeJS/dms-saas/commit/47f60b8))
- **release:** @antelopejs/dms-saas v0.3.7 ([136918e](https://github.com/AntelopeJS/dms-saas/commit/136918e))
- **release:** @antelopejs/dms-saas v0.3.8 ([34de0b7](https://github.com/AntelopeJS/dms-saas/commit/34de0b7))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.5

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.4...v0.2.5)

### 🚀 Enhancements

- **plans:** Keep every Stripe-billed plan synced, whoever writes it ([#65](https://github.com/AntelopeJS/dms-saas/pull/65))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.5 ([623dd20](https://github.com/AntelopeJS/dms-saas/commit/623dd20))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.4

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.3...v0.2.4)

### 🩹 Fixes

- **deps:** Cap @antelopejs/interface-dms-saas below the next minor and check interface ranges ([#63](https://github.com/AntelopeJS/dms-saas/pull/63))
- **deps:** Move to @antelopejs/dms 0.5.0 and interface-dms 0.3.1 ([#64](https://github.com/AntelopeJS/dms-saas/pull/64))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.3 ([f64bc54](https://github.com/AntelopeJS/dms-saas/commit/f64bc54))
- **release:** @antelopejs/dms-saas v0.3.4 ([5e410ec](https://github.com/AntelopeJS/dms-saas/commit/5e410ec))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.3

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.2...v0.2.3)

### 🔥 Performance

- **db:** Mark cross-instance indexes and upgrade the database stack ([#59](https://github.com/AntelopeJS/dms-saas/pull/59))

### 🩹 Fixes

- **db:** Key Stripe mirror rows and tenant singletons by stable ids ([#51](https://github.com/AntelopeJS/dms-saas/pull/51))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.2 ([6383aad](https://github.com/AntelopeJS/dms-saas/commit/6383aad))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.1...v0.2.2)

### 🩹 Fixes

- **deps:** Sync the lockfile with the interface-dms-saas >=0.2.1 floor ([#57](https://github.com/AntelopeJS/dms-saas/pull/57))

### 💅 Refactors

- **dms-saas:** Remove support ticketing feature ([#49](https://github.com/AntelopeJS/dms-saas/pull/49))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.1 ([148fbf0](https://github.com/AntelopeJS/dms-saas/commit/148fbf0))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.2.0...v0.2.1)

### 🩹 Fixes

- **segments:** Rotate the revision when the data API edits a segment ([#55](https://github.com/AntelopeJS/dms-saas/pull/55))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.3.0 ([d6f208d](https://github.com/AntelopeJS/dms-saas/commit/d6f208d))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.1.2...v0.2.0)

### 🩹 Fixes

- **playground:** Start the playground on a fresh clone ([#47](https://github.com/AntelopeJS/dms-saas/pull/47))

### 💅 Refactors

- **billing:** ⚠️  Drop tolerance for legacy subscription, invoice and webhook rows ([#50](https://github.com/AntelopeJS/dms-saas/pull/50))
- **billing:** ⚠️  Always write revision and paid usage periods ([#53](https://github.com/AntelopeJS/dms-saas/pull/53))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.2.1 ([6c0e08a](https://github.com/AntelopeJS/dms-saas/commit/6c0e08a))
- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#52](https://github.com/AntelopeJS/dms-saas/pull/52))

#### ⚠️ Breaking Changes

- **billing:** ⚠️  Drop tolerance for legacy subscription, invoice and webhook rows ([#50](https://github.com/AntelopeJS/dms-saas/pull/50))
- **billing:** ⚠️  Always write revision and paid usage periods ([#53](https://github.com/AntelopeJS/dms-saas/pull/53))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.1.1...v0.1.2)

### 🚀 Enhancements

- **backoffice:** Make owner invitations visible and recoverable ([#35](https://github.com/AntelopeJS/dms-saas/pull/35))
- **billing:** Billing page per the product, always-a-plan, global past-due banner ([#36](https://github.com/AntelopeJS/dms-saas/pull/36))
- **invitations:** Name the workspace and inviter in owner invitation emails ([#39](https://github.com/AntelopeJS/dms-saas/pull/39))
- **seats:** Let platform support enter a workspace without taking a seat ([#42](https://github.com/AntelopeJS/dms-saas/pull/42))
- **billing:** Upcoming invoice preview API ([#43](https://github.com/AntelopeJS/dms-saas/pull/43))

### 🩹 Fixes

- **registration:** Short, card-optional registration flow ([#34](https://github.com/AntelopeJS/dms-saas/pull/34))
- **billing:** Readable plan comparison ([#37](https://github.com/AntelopeJS/dms-saas/pull/37))
- **billing:** Translated text values, quiet suspended billing page, consistent back office ([#38](https://github.com/AntelopeJS/dms-saas/pull/38))
- **invitations:** Resending an owner invitation must not hit the seat limit ([#40](https://github.com/AntelopeJS/dms-saas/pull/40))
- **workspaces:** Clearer suspended billing copy and translated back-office tabs ([#41](https://github.com/AntelopeJS/dms-saas/pull/41))
- **seats:** A platform owner who owns the workspace is a real member ([#45](https://github.com/AntelopeJS/dms-saas/pull/45))

### 💅 Refactors

- **billing:** Adopt the DMS layout banner, access redirect and nested donut ([#44](https://github.com/AntelopeJS/dms-saas/pull/44))

### 🏡 Chore

- **release:** @antelopejs/dms-saas v0.2.0 ([544bb48](https://github.com/AntelopeJS/dms-saas/commit/544bb48))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.1.0...v0.1.1)

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.0.2...v0.1.0)

### 🚀 Enhancements

- Declare the workspace finalize endpoint as session-opening ([#11](https://github.com/AntelopeJS/dms-saas/pull/11))
- Extend the DMS members page by its page id ([#12](https://github.com/AntelopeJS/dms-saas/pull/12))

### 🩹 Fixes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-saas/pull/4))
- **frontend:** Open the workspace session through the Inertia loader ([#6](https://github.com/AntelopeJS/dms-saas/pull/6))
- **frontend:** Point legal links to registered pages ([#17](https://github.com/AntelopeJS/dms-saas/pull/17))
- **dms:** Use unified frontend CLI commands ([#16](https://github.com/AntelopeJS/dms-saas/pull/16))
- **frontend:** Match workspace switcher mockup ([#15](https://github.com/AntelopeJS/dms-saas/pull/15))
- **playground:** Use hoisted dependency layout ([#20](https://github.com/AntelopeJS/dms-saas/pull/20))
- **playground:** Configure DMS JWT secret ([#21](https://github.com/AntelopeJS/dms-saas/pull/21))
- **frontend:** Theme the workspace switcher with app tokens ([#22](https://github.com/AntelopeJS/dms-saas/pull/22))

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#14](https://github.com/AntelopeJS/dms-saas/pull/14))
- **build:** Merge tsconfig.build.json into tsconfig.json ([#27](https://github.com/AntelopeJS/dms-saas/pull/27))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#31](https://github.com/AntelopeJS/dms-saas/pull/31))

### 🏡 Chore

- **release:** Build the interface package before releasing the runtime ([#3](https://github.com/AntelopeJS/dms-saas/pull/3))
- **release:** @antelopejs/dms-saas v0.0.2 ([1b6ebab](https://github.com/AntelopeJS/dms-saas/commit/1b6ebab))
- **frontend:** Drop the Nuxt-era server route ([#5](https://github.com/AntelopeJS/dms-saas/pull/5))
- **release:** @antelopejs/dms-saas v0.1.0 ([a4affe0](https://github.com/AntelopeJS/dms-saas/commit/a4affe0))
- **release:** @antelopejs/dms-saas v0.1.1 ([e8d1264](https://github.com/AntelopeJS/dms-saas/commit/e8d1264))
- **release:** @antelopejs/dms-saas v0.1.2 ([03a0893](https://github.com/AntelopeJS/dms-saas/commit/03a0893))
- **release:** @antelopejs/dms-saas v0.1.3 ([83ee168](https://github.com/AntelopeJS/dms-saas/commit/83ee168))
- Require @antelopejs/core 1.7 ([#10](https://github.com/AntelopeJS/dms-saas/pull/10))
- **release:** @antelopejs/dms-saas v0.1.4 ([23290ad](https://github.com/AntelopeJS/dms-saas/commit/23290ad))
- **release:** @antelopejs/dms-saas v0.1.5 ([061a0aa](https://github.com/AntelopeJS/dms-saas/commit/061a0aa))
- Align community files with the organization defaults ([#13](https://github.com/AntelopeJS/dms-saas/pull/13))
- **release:** @antelopejs/dms-saas v0.1.6 ([adfdf6b](https://github.com/AntelopeJS/dms-saas/commit/adfdf6b))
- **release:** @antelopejs/dms-saas v0.1.7 ([2bc2dca](https://github.com/AntelopeJS/dms-saas/commit/2bc2dca))
- Add orb playground setup ([#19](https://github.com/AntelopeJS/dms-saas/pull/19))
- **release:** @antelopejs/dms-saas v0.1.8 ([d5fe3c7](https://github.com/AntelopeJS/dms-saas/commit/d5fe3c7))
- **agents:** Install Node 24 in setup script ([#23](https://github.com/AntelopeJS/dms-saas/pull/23))
- **playground:** Derive the api origin from config variables ([#25](https://github.com/AntelopeJS/dms-saas/pull/25))
- **playground:** Drop the private registry from .npmrc ([#30](https://github.com/AntelopeJS/dms-saas/pull/30))

### ✅ Tests

- **support:** Drop the DMS metadata assertion reaching into node_modules ([#24](https://github.com/AntelopeJS/dms-saas/pull/24))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#28](https://github.com/AntelopeJS/dms-saas/pull/28))
- **release:** Reference the shared release workflows through v1 ([#29](https://github.com/AntelopeJS/dms-saas/pull/29))

#### ⚠️ Breaking Changes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-saas/pull/4))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#31](https://github.com/AntelopeJS/dms-saas/pull/31))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.0.1...v0.0.2)

### 🏡 Chore

- Regenerate lockfiles against the published DMS packages ([#1](https://github.com/AntelopeJS/dms-saas/pull/1))
- **release:** Skip the npm auth pre-flight for trusted publishing ([#2](https://github.com/AntelopeJS/dms-saas/pull/2))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

