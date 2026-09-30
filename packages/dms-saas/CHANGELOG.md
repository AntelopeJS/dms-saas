# Changelog

## v0.3.5

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.3.4...v0.3.5)

### 🩹 Fixes

- **deps:** Move to @antelopejs/dms 0.5.0 and interface-dms 0.3.1 ([#64](https://github.com/AntelopeJS/dms-saas/pull/64))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-saas v0.2.4 ([58ae025](https://github.com/AntelopeJS/dms-saas/commit/58ae025))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.4

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.3.3...v0.3.4)

### 🩹 Fixes

- **deps:** Cap @antelopejs/interface-dms-saas below the next minor and check interface ranges ([#63](https://github.com/AntelopeJS/dms-saas/pull/63))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.3

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.3.2...v0.3.3)

### 🔥 Performance

- **db:** Mark cross-instance indexes and upgrade the database stack ([#59](https://github.com/AntelopeJS/dms-saas/pull/59))

### 🩹 Fixes

- **db:** Key Stripe mirror rows and tenant singletons by stable ids ([#51](https://github.com/AntelopeJS/dms-saas/pull/51))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-saas v0.2.3 ([0e05ed0](https://github.com/AntelopeJS/dms-saas/commit/0e05ed0))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.3.1...v0.3.2)

### 💅 Refactors

- **dms-saas:** Remove support ticketing feature ([#49](https://github.com/AntelopeJS/dms-saas/pull/49))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-saas v0.2.2 ([78a1585](https://github.com/AntelopeJS/dms-saas/commit/78a1585))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.3.0...v0.3.1)

### 🩹 Fixes

- **segments:** Rotate the revision when the data API edits a segment ([#55](https://github.com/AntelopeJS/dms-saas/pull/55))
- **deps:** Sync the lockfile with the interface-dms-saas >=0.2.1 floor ([#57](https://github.com/AntelopeJS/dms-saas/pull/57))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-saas v0.2.1 ([d47b84a](https://github.com/AntelopeJS/dms-saas/commit/d47b84a))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.2.1...v0.3.0)

### 🩹 Fixes

- **playground:** Start the playground on a fresh clone ([#47](https://github.com/AntelopeJS/dms-saas/pull/47))

### 💅 Refactors

- **billing:** ⚠️  Drop tolerance for legacy subscription, invoice and webhook rows ([#50](https://github.com/AntelopeJS/dms-saas/pull/50))
- **billing:** ⚠️  Always write revision and paid usage periods ([#53](https://github.com/AntelopeJS/dms-saas/pull/53))

### 🏡 Chore

- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#52](https://github.com/AntelopeJS/dms-saas/pull/52))
- **release:** @antelopejs/interface-dms-saas v0.2.0 ([b022294](https://github.com/AntelopeJS/dms-saas/commit/b022294))

#### ⚠️ Breaking Changes

- **billing:** ⚠️  Drop tolerance for legacy subscription, invoice and webhook rows ([#50](https://github.com/AntelopeJS/dms-saas/pull/50))
- **billing:** ⚠️  Always write revision and paid usage periods ([#53](https://github.com/AntelopeJS/dms-saas/pull/53))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.2.0...v0.2.1)

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

- **release:** @antelopejs/interface-dms-saas v0.1.2 ([e7cbcf1](https://github.com/AntelopeJS/dms-saas/commit/e7cbcf1))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.8...v0.2.0)

### 💅 Refactors

- **build:** Merge tsconfig.build.json into tsconfig.json ([#27](https://github.com/AntelopeJS/dms-saas/pull/27))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#31](https://github.com/AntelopeJS/dms-saas/pull/31))

### 🏡 Chore

- **agents:** Install Node 24 in setup script ([#23](https://github.com/AntelopeJS/dms-saas/pull/23))
- **playground:** Derive the api origin from config variables ([#25](https://github.com/AntelopeJS/dms-saas/pull/25))
- **playground:** Drop the private registry from .npmrc ([#30](https://github.com/AntelopeJS/dms-saas/pull/30))
- **release:** @antelopejs/interface-dms-saas v0.1.0 ([6c4d4ae](https://github.com/AntelopeJS/dms-saas/commit/6c4d4ae))
- **release:** @antelopejs/interface-dms-saas v0.1.1 ([2c70b49](https://github.com/AntelopeJS/dms-saas/commit/2c70b49))

### ✅ Tests

- **support:** Drop the DMS metadata assertion reaching into node_modules ([#24](https://github.com/AntelopeJS/dms-saas/pull/24))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#28](https://github.com/AntelopeJS/dms-saas/pull/28))
- **release:** Reference the shared release workflows through v1 ([#29](https://github.com/AntelopeJS/dms-saas/pull/29))

#### ⚠️ Breaking Changes

- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#31](https://github.com/AntelopeJS/dms-saas/pull/31))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.8

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.7...v0.1.8)

### 🩹 Fixes

- **playground:** Use hoisted dependency layout ([#20](https://github.com/AntelopeJS/dms-saas/pull/20))
- **playground:** Configure DMS JWT secret ([#21](https://github.com/AntelopeJS/dms-saas/pull/21))
- **frontend:** Theme the workspace switcher with app tokens ([#22](https://github.com/AntelopeJS/dms-saas/pull/22))

### 🏡 Chore

- Add orb playground setup ([#19](https://github.com/AntelopeJS/dms-saas/pull/19))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.7

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.6...v0.1.7)

### 🩹 Fixes

- **frontend:** Point legal links to registered pages ([#17](https://github.com/AntelopeJS/dms-saas/pull/17))
- **dms:** Use unified frontend CLI commands ([#16](https://github.com/AntelopeJS/dms-saas/pull/16))
- **frontend:** Match workspace switcher mockup ([#15](https://github.com/AntelopeJS/dms-saas/pull/15))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.6

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.5...v0.1.6)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#14](https://github.com/AntelopeJS/dms-saas/pull/14))

### 🏡 Chore

- Align community files with the organization defaults ([#13](https://github.com/AntelopeJS/dms-saas/pull/13))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.5

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.4...v0.1.5)

### 🚀 Enhancements

- Extend the DMS members page by its page id ([#12](https://github.com/AntelopeJS/dms-saas/pull/12))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.4

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.3...v0.1.4)

### 🚀 Enhancements

- Declare the workspace finalize endpoint as session-opening ([#11](https://github.com/AntelopeJS/dms-saas/pull/11))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#10](https://github.com/AntelopeJS/dms-saas/pull/10))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.2...v0.1.3)

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.1...v0.1.2)

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.1.0...v0.1.1)

### 🩹 Fixes

- **frontend:** Open the workspace session through the Inertia loader ([#6](https://github.com/AntelopeJS/dms-saas/pull/6))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/v0.0.2...v0.1.0)

### 🩹 Fixes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-saas/pull/4))

### 🏡 Chore

- **frontend:** Drop the Nuxt-era server route ([#5](https://github.com/AntelopeJS/dms-saas/pull/5))

#### ⚠️ Breaking Changes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-saas/pull/4))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-saas/compare/interface-v0.0.2...v0.0.2)

### 🏡 Chore

- **release:** Build the interface package before releasing the runtime ([#3](https://github.com/AntelopeJS/dms-saas/pull/3))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

