# dms-saas

## Layout

A pnpm workspace with two published packages. The root holds the tool configs, the CI workflows and nothing else.

| Path                             | What it is                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/dms-saas`              | `@antelopejs/dms-saas`, the module: sources, Vitest suite (`test/`), skills, docs                                         |
| `packages/dms-saas/frontend-vue` | The Vue layer, shipped as source. ESLint and Prettier own it, not oxlint and oxfmt. It keeps a lockfile for standalone consumers |
| `packages/dms-saas/playground`   | An AntelopeJS project that runs the module against MongoDB. Not a workspace package: its private dependencies need registry access, so install it with `--ignore-workspace` |
| `packages/interface-dms-saas`    | `@antelopejs/interface-dms-saas`, the extension points other modules import                                                |

The module's typecheck and oxlint's type-aware rules resolve the interface through its built `dist`, so the root `typecheck` script is the build of both packages, and `lint` runs after it.

## Versioning

- The module implements the interface, so it depends on it through `>=<interface version> <0.<minor + 1>.0` (`workspace:^` packs to that). `release.yml` refuses any other shape. Release the interface on its own workflow before the module.
- `antelopejs-check-interface-ranges` (part of `pnpm lint`) checks every other `@antelopejs/interface-*` range.
- `frontend-vue/package.json` pins the `@antelopejs/dms-frontend` minor it builds against in `engines`. Move it together with the `@antelopejs/dms-frontend` range in `packages/dms-saas/package.json` and `playground/package.json`, and the compatibility table in `README.md`.

## What `pnpm run checks` does not run

- `pnpm --filter @antelopejs/dms-saas test:frontend`. It builds the client, SSR and e-mail bundles with the DMS frontend source and typechecks them. CI runs it in the `frontend` job.
- Prettier on `frontend-vue`. `pnpm format` applies it; nothing checks it.
- The playground's typecheck and build (oxlint still lints it). Run `.agents/playground`, then `pnpm --filter @antelopejs/dms-saas dev`.
- Unused files and exports. `pnpm knip` checks dependencies only. `pnpm --filter <package> knip:all` also reports dead files and exports, and expects findings: confirm each one before you remove it.

The Vitest suite starts an in-memory MongoDB. The first run downloads mongod 8.0.8 (about 200 MB) into `~/.cache/mongodb-binaries`.

## Orb

`.agents/setup` belongs to the guardrail pack. `.agents/playground` installs the AntelopeJS CLI and MongoDB, builds the module and installs the playground. The `dms-saas-backend` service runs it before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
