<div align="center">

# `@antelopejs/interface-dms-saas`

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-saas"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-saas?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-saas?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="https://discord.gg/g4pFt6eXqu"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" data-illustration></a>
<a href="https://dms.antelopejs.com/docs/modules/saas/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" data-illustration></a>

The AntelopeJS interface that extends the DMS SaaS module with billing, plans, registration, workspace pages and lifecycle.

</div>

## What it does

- Adds invoice line items, reads customer balances and previews the upcoming invoice.
- Builds plan projections and catalogues, and normalizes prices.
- Extends registration and the provisioning of a new workspace.
- Adds blocks to the tenant billing page and the platform workspace detail page.
- Listens to tenant lifecycle events, guards paid-to-Free plan changes, and exposes the canonical SaaS tables and models (`/db`).

A module that extends [`@antelopejs/dms-saas`](https://www.npmjs.com/package/@antelopejs/dms-saas) depends on this package, never on the runtime.

## Install

```bash
pnpm add @antelopejs/interface-dms-saas
```

## Quick start

The root entry holds every extension point except `db`. `invoiceLineItems`, `tenantLifecycle` and `planChanges` are namespaces at the root:

```ts docs-check
import { invoiceLineItems, tenantLifecycle } from "@antelopejs/interface-dms-saas";

export const usageKey = invoiceLineItems.buildInvoiceLineKey("example.compute", "minutes");
export const isProvisioningCommitted = tenantLifecycle.IsTenantProvisioningCommitted;
```

The [entry-point reference](./docs/1.index.md#entry-points) lists the supported subpaths. Importing `/db` registers the SaaS tables, so it is not a types-only import. After direct subscription writes, call [`RecomputeTenantBillingState`](./docs/2.billing.md#recomputetenantbillingstate) to refresh the derived billing state and the workspace directory row.

A module may seed plans straight into the `db` plan table. It writes `name`, `description` and `borderLabel` with one value per locale on the `PlanInAllLocales` view that `localize("*", PLAN_LOCALIZED_FIELDS)` returns. It leaves `Plan.paymentProviderRefs` empty and never rewrites it, because `@antelopejs/dms-saas` links every billed plan to Stripe itself. See [Plans and their Stripe products](https://dms.antelopejs.com/docs/modules/saas/stripe#plans-and-their-stripe-products).

## Compatibility

`@antelopejs/dms-saas` implements this interface. The compatibility block of its [README](../dms-saas/README.md#compatibility) lists the interface range each module release supports. The interface declares these dependencies:

<!-- antelopejs-docs-compat:start -->

| Package                                     | Supported                                                        | Tested with                                                |
| ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `@antelopejs/interface-core`                | `>=0.2.4 <1.0.0`                                                 | `0.4.0`                                                    |
| `@antelopejs/interface-data-api`            | `file:../../.tgz-deps/antelopejs-interface-data-api-d70049c.tgz` | `file:.tgz-deps/antelopejs-interface-data-api-d70049c.tgz` |
| `@antelopejs/interface-database`            | `>=0.1.11 <1.0.0`                                                | `0.4.0`                                                    |
| `@antelopejs/interface-database-decorators` | `>=0.2.2 <1.0.0`                                                 | `0.5.2`                                                    |
| `@antelopejs/interface-dms`                 | `file:../../.tgz-deps/antelopejs-interface-dms-0be8e9a.tgz`      | `file:.tgz-deps/antelopejs-interface-dms-0be8e9a.tgz`      |

<!-- antelopejs-docs-compat:end -->

`@antelopejs/interface-core`, `@antelopejs/interface-database` and `@antelopejs/interface-database-decorators` are peer dependencies. `@antelopejs/interface-data-api` and `@antelopejs/interface-dms` are regular dependencies.

Subpaths resolve through the `exports` map only, so compile consumers with `moduleResolution` set to `bundler`, `node16` or `nodenext`. Upgrade this package together with `@antelopejs/dms-saas`. The [upgrade notes](https://dms.antelopejs.com/docs/modules/saas/faq#upgrading) cover the tenant billing page anchors and the rows written by earlier builds.

## Documentation

- The [consumer reference](./docs/1.index.md) covers billing, usage, lifecycle, pages, plans and the database boundary.
- [Extending the SaaS module](https://dms.antelopejs.com/docs/modules/saas/extending) shows every extension point with examples.
- [Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe) explains how the module drives Stripe.
- The [SaaS module guide](https://dms.antelopejs.com/docs/modules/saas) covers installation and configuration.

## Contributing

This package lives in the [`AntelopeJS/dms-saas`](https://github.com/AntelopeJS/dms-saas) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-saas/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-saas#contributing) for the development commands. Release this package on its own workflow before the module that implements it.

## License

[Apache-2.0](./LICENSE)
