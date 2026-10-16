<div align="center">

# @antelopejs/interface-dms-saas

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-saas"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-saas?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-saas?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/saas/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The AntelopeJS interface to extend the DMS SaaS module: billing, plans, registration, workspace pages and lifecycle.

</div>

## What it does

- Adds invoice line items, reads customer balances and previews the upcoming invoice.
- Builds plan projections and catalogues, and normalizes prices.
- Extends registration and the provisioning of a new workspace.
- Adds workspace settings categories and blocks to the tenant billing page.
- Listens to workspace lifecycle events and operator actions, and exposes the canonical SaaS tables and models (`/db`).

A module that extends [`@antelopejs/dms-saas`](https://www.npmjs.com/package/@antelopejs/dms-saas) depends on this package, never on the runtime.

## Install

```bash
pnpm add @antelopejs/interface-dms-saas
```

## Quick start

The root entry holds every extension point except `db`, with `invoiceLineItems` and `workspaceLifecycle` as namespaces:

```ts
import { invoiceLineItems, workspaceLifecycle } from "@antelopejs/interface-dms-saas";

invoiceLineItems.RegisterInvoiceLineItemsProvider(/* … */);
```

| Subpath | Surface |
| --- | --- |
| `@antelopejs/interface-dms-saas/billing` | customer balance, upcoming invoice preview, complimentary subscription state |
| `@antelopejs/interface-dms-saas/data-api` | hidden-value data API filters |
| `@antelopejs/interface-dms-saas/db` | canonical SaaS tables and data models (importing it registers the tables) |
| `@antelopejs/interface-dms-saas/hidden-filter` | the `HiddenStringFilter` decorator on its own |
| `@antelopejs/interface-dms-saas/invoice-line-items` | provider registration, line item types, line key helpers |
| `@antelopejs/interface-dms-saas/page-definitions` | page and module ids, slugs and descriptors |
| `@antelopejs/interface-dms-saas/pages` | workspace settings category and tenant billing page extensions |
| `@antelopejs/interface-dms-saas/plans` | plan projections, catalogue builder, price normalization |
| `@antelopejs/interface-dms-saas/provisioning` | provisioning hook payload |
| `@antelopejs/interface-dms-saas/registration` | public registration capture limits |
| `@antelopejs/interface-dms-saas/workspace-lifecycle` | workspace lifecycle events and operator actions |

A module may seed plans straight into the `db` plan table: it leaves `Plan.paymentProviderRefs` empty and never rewrites it, since dms-saas links every billed plan to Stripe itself. See [Plans and Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe#plans-and-stripe).

## Compatibility

| Package | Version |
| --- | --- |
| `@antelopejs/dms-saas` (implementation) | `>=0.6.0` |
| `@antelopejs/interface-dms` | `>=0.6.0 <1.0.0` |
| `@antelopejs/interface-core` | `>=0.1.1 <1.0.0` |

Subpaths resolve through the `exports` map only: compile consumers with `moduleResolution` set to `bundler`, `node16` or `nodenext`. Upgrade this package together with `@antelopejs/dms-saas`; the [upgrade notes](https://dms.antelopejs.com/docs/modules/saas/faq#upgrading) cover the tenant billing page anchors and the rows written by earlier builds.

## Documentation

- [Extending the SaaS module](https://dms.antelopejs.com/docs/modules/saas/extending): every extension point with examples
- [Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe)
- [SaaS module guide](https://dms.antelopejs.com/docs/modules/saas)

## Contributing

This package lives in the [`AntelopeJS/dms-saas`](https://github.com/AntelopeJS/dms-saas) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-saas/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-saas#contributing) for the development commands. Release this package on its own workflow before the module that implements it.

## License

[Apache-2.0](./LICENSE)
