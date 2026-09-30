# Changelog

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

