<div align="center">

# @antelopejs/dms-saas

<a href="https://www.npmjs.com/package/@antelopejs/dms-saas"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-saas?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-saas?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/saas"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

Sign-up, plans, Stripe billing and a back office for a multi-tenant AntelopeJS DMS.

</div>

![The SaaS back office dashboard: what needs attention, recurring revenue and workspaces by status](https://raw.githubusercontent.com/AntelopeJS/dms-saas/main/packages/dms-saas/docs/images/dashboard.png)

## What it does

- Adds public pricing and registration screens, legal pages, and a completion screen for OAuth sign-ins.
- Defines plans whose permissions cap what each workspace can do, with features, limits, trials and seat pricing.
- Bills through Stripe: checkout, subscriptions, invoices, credit notes, refunds and Stripe Tax, with plans kept in sync.
- Gives workspace owners their settings: general, members, billing and data export.
- Gives the platform owner a back office: workspaces, users, segments, plan migrations, billing rules and legal documents.

## Install

Run the AntelopeJS CLI from the root of a project that loads `@antelopejs/dms` in multi-tenant mode, with an e-mail module and a file storage:

```bash
ajs project modules add @antelopejs/dms-saas
```

## Quick start

Give the module its Stripe keys from the environment:

```ts
// antelope.config.ts
export default defineConfig({
  name: "my-saas",
  envOverrides: {
    STRIPE_SECRET_KEY: "modules.dms-saas.config.stripe.secretKey",
    STRIPE_PUBLISHABLE_KEY: "modules.dms-saas.config.stripe.publishableKey",
    STRIPE_WEBHOOK_SECRET: "modules.dms-saas.config.stripe.webhookSecret",
  },
  modules: {
    "dms-saas": {
      source: { type: "package", package: "@antelopejs/dms-saas", version: "^0.6.0" },
      config: {
        stripe: {
          secretKey: "sk_test_placeholder",
          publishableKey: "pk_test_placeholder",
          webhookSecret: "whsec_placeholder",
        },
      },
    },
    // dms, api, mongodb, auth-jwt, nodemailer, file-storage-local, ...
  },
});
```

Then point a Stripe webhook at `https://<api>/api/saas/webhooks/stripe`, set `DMS_AUTH_ESTABLISH_ENDPOINTS=/api/saas/register/finalize` in the frontend server's environment, and publish a free plan in **Modules › SaaS › Plans**: registration opens every workspace on it. With placeholder keys the module still runs, and the Stripe-backed blocks say so.

## Compatibility

| Package | Version |
| --- | --- |
| `@antelopejs/dms` | `>=0.11.0 <1.0.0` |
| `@antelopejs/interface-dms` | `>=0.9.0 <1.0.0` |
| `@antelopejs/dms-frontend` (renderer) | `>=0.9.0 <0.10.0` |
| `@antelopejs/interface-dms-saas` | `>=0.6.0 <0.7.0` |
| Stripe API version | `2026-08-26.dahlia` |

On DMS 0.10 or earlier, use `@antelopejs/dms-saas` 0.8. Before upgrading an existing database, read [Upgrading](https://dms.antelopejs.com/docs/modules/saas/faq#upgrading).

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/saas/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/saas/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/saas/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/saas/usage/public-screens)
- [Extending](https://dms.antelopejs.com/docs/modules/saas/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/saas/faq)
- [Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe)
- [Operations](https://dms.antelopejs.com/docs/modules/saas/operations)

The guide's sources live in [`packages/dms-saas/docs`](https://github.com/AntelopeJS/dms-saas/tree/main/packages/dms-saas/docs). The module ships the `dms-saas` Claude Code skill in [`packages/dms-saas/skills`](https://github.com/AntelopeJS/dms-saas/tree/main/packages/dms-saas/skills), declared under `antelopeJs.skills`.

## Contributing

This package lives in the [`AntelopeJS/dms-saas`](https://github.com/AntelopeJS/dms-saas) pnpm workspace, next to `@antelopejs/interface-dms-saas`. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-saas/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-saas#contributing) for the development commands.

## License

[Apache-2.0](./LICENSE)
