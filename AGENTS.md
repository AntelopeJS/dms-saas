# dms-saas

## Layout

A pnpm workspace with two published packages. The root holds the tool configs, the CI workflows and nothing else.

| Path                             | What it is                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/dms-saas`              | `@antelopejs/dms-saas`, the module: sources, Vitest suite (`test/`), skills, docs                                         |
| `packages/dms-saas/frontend-vue` | The Vue layer, shipped as source. ESLint and Prettier own it, not oxlint and oxfmt. It keeps a lockfile for standalone consumers |
| `packages/dms-saas/playground`   | An AntelopeJS project that runs the module against MongoDB. Not a workspace package: it has its own lockfile and a hoisted linker, so install it with `--ignore-workspace` |
| `packages/interface-dms-saas`    | `@antelopejs/interface-dms-saas`, the extension points other modules import                                                |

The module's typecheck and oxlint's type-aware rules resolve the interface through its built `dist`, so the root `typecheck` script is the build of both packages, and `lint` runs after it. Run `pnpm build` after `pnpm install`: without a `dist`, the pre-commit lint hook reports false type errors and `check:exports` fails.

## Versioning

- The module implements the interface, so it depends on it through `>=<interface version> <0.<minor + 1>.0` (`workspace:^` packs to that). Both packages release through `release.yml`: release the interface before the module.
- The `dependency:ranges` step of `pnpm run checks` checks every other `@antelopejs/*` range.
- `packages/dms-saas/frontend-vue/package.json` pins the `@antelopejs/dms-frontend` minor it builds against in `engines`. Move it together with the `@antelopejs/dms-frontend` range in `packages/dms-saas/package.json` and `packages/dms-saas/playground/package.json`, and the compatibility table in `README.md`.

## Invariant checks

`pnpm lint` ends with `node packages/dms-saas/scripts/checks/index.mts`, the rules over many files: the locale catalogs (each key declared in one file, every locale with the reference keys and placeholders, no empty message, the keys screens read, both forms of a seat count), locale keys nothing reads, components drawing several roots without `inheritAttrs: false`, and which frontend reads may hold a server render. It prints only what failed. Add a rule there, not a test that reads sources.

## What `pnpm run checks` does not run

- The Vitest suite: `pnpm --filter @antelopejs/dms-saas test:unit`. It starts an in-memory MongoDB, and CI runs it in the `unit` job, in parallel with the `ci` job. The root `test` script only runs the interface's `check:exports`.
- `pnpm --filter @antelopejs/dms-saas test:frontend`. It builds the client, SSR and e-mail bundles with the DMS frontend source and typechecks them. CI runs it in the `frontend` job.
- Prettier on `frontend-vue`. `pnpm format` applies it; nothing checks it.
- The documentation check: Markdown links and the code examples in the READMEs and `docs` folders, typechecked through `packages/interface-dms-saas/docs/tsconfig.json`. Only the `checks` CI job runs it, with the file list in `.github/workflows/ci.yml`.
- The test files' typecheck. `packages/dms-saas/tsconfig.json` covers `src` only, and Vitest strips types without checking them. CI runs it in the `test-types` job: build the interface, then `pnpm --dir packages/dms-saas exec tsc --noEmit -p test`. `test/tsconfig.json` excludes the tests that reach a frontend composable reading the DMS auto-imports, which only exist in the workspace `test:frontend` builds. `test/tsconfig.frontend-auto-imports.json`, which `test/tsconfig.json` references, lists them so type-aware lint still reads them; nothing typechecks them. A new test that reaches such a composable fails the job until it is on both lists.
- The playground's typecheck (oxlint still lints it). `pnpm --filter @antelopejs/dms-saas dev` transpiles it with `--noCheck`. CI runs it in the `playground` job. Run `pnpm build`, then `pnpm install --dir packages/dms-saas/playground --ignore-workspace --frozen-lockfile`, then `pnpm --dir packages/dms-saas/playground exec tsc --noEmit -p .`.
- Unused files and exports. `pnpm knip` checks dependencies only. `pnpm --filter <package> knip:all` also reports dead files and exports, and expects findings: confirm each one before you remove it.

The Vitest suite's first run downloads mongod 8.0.8 (about 200 MB) into `~/.cache/mongodb-binaries`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-saas/SKILL.md`](.agents/skills/verify-dms-saas/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
