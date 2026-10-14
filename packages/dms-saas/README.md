# @antelopejs/dms-saas

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

SaaS extension module for the AntelopeJS DMS: self-service sign-up and pricing,
plans that cap each workspace's permissions, Stripe subscriptions, invoices and
credit notes, workspace settings for customers, and a back office for the
platform owner (workspaces, users, segments, plans, plan migrations, billing
rules and legal documents).

![The SaaS back office dashboard](./docs/images/dashboard.png)

**Documentation: [dms.antelopejs.com/docs/modules/saas](https://dms.antelopejs.com/docs/modules/saas)**
(sources in [`docs/`](./docs); design notes in [`docs/design/`](./docs/design)).

## Installation

```bash
ajs project modules add @antelopejs/dms-saas
```

Then give the module its Stripe keys, point a Stripe webhook at
`/api/saas/webhooks/stripe`, and set
`DMS_AUTH_ESTABLISH_ENDPOINTS=/api/saas/register/finalize` on the frontend
server. See [Installation](https://dms.antelopejs.com/docs/modules/saas/installation),
[Configuration](https://dms.antelopejs.com/docs/modules/saas/configuration) and
[Extending](https://dms.antelopejs.com/docs/modules/saas/extending). Upgrading
an existing database: read [Upgrading](https://dms.antelopejs.com/docs/modules/saas/faq#upgrading)
first.

## Claude Code skill

The package ships the `dms-saas` skill in [`skills/`](./skills), declared in
`package.json` under `antelopeJs.skills`.

## Development

The module registers `frontend-vue/dms.frontend.ts` with the Vue 3 Inertia
adapter. It preserves the `DmsSaas*` component names, the `auth/no-workspace`
page override, client-only displays, global guards, and English/French catalogs.
Public module configuration is exposed under `public.dmsSaas`. Stripe secrets
are never exposed to the frontend.

The backend integration requires `@antelopejs/dms`. Frontend source
verification runs through `@antelopejs/dms-frontend` and the DMS frontend
source shipped in that published DMS package; no sibling checkout or local
package link is required.

This package lives in `packages/dms-saas` of the `AntelopeJS/dms-saas`
workspace. From that directory run `pnpm install`,
`pnpm --dir frontend-vue install`, `pnpm build`, `pnpm typecheck`, and
`pnpm test:frontend`. The frontend check generates a temporary workspace, then
builds client, SSR, and email bundles and runs Vue typechecking. To run the
playground frontend during backend development, use `pnpm frontend:dev`; this
dispatches through the core CLI as `ajs dms dev`. The playground connects to
MongoDB at `mongodb://localhost:27017` unless `MONGO_URL` is set, either in the
environment or in `playground/.env`.
Sign-in with GitHub and Google is wired to `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, read the
same way: a provider's button appears on the login and register screens once
both of its values are set, with
`http://localhost:3001/auth/oauth/<provider>/callback` registered as its
callback URL.

The playground seeds a data set on its first start (sign in as
`admin@example.com` / `Playground-Admin-1!`); see
[Installation](https://dms.antelopejs.com/docs/modules/saas/installation#playground-data-set).
