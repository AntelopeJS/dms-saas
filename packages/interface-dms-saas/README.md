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
- Listens to tenant lifecycle events and operator actions, and exposes the canonical SaaS tables and models (`/db`).

A module that extends [`@antelopejs/dms-saas`](https://www.npmjs.com/package/@antelopejs/dms-saas) depends on this package, never on the runtime.

## Install

```bash
pnpm add @antelopejs/interface-dms-saas
```

## Quick start

The root entry holds every extension point except `db`, with `invoiceLineItems` and `tenantLifecycle` as namespaces:

```ts docs-check
import { invoiceLineItems, tenantLifecycle } from "@antelopejs/interface-dms-saas";

export const usageKey = invoiceLineItems.buildInvoiceLineKey("example.compute", "minutes");
export const isProvisioningCommitted = tenantLifecycle.IsTenantProvisioningCommitted;
```

Use the [entry-point reference](./docs/1.index.md#entry-points) for supported
subpaths. Importing `/db` registers SaaS tables; it is not a side-effect-free
types barrel. After direct subscription writes, call
[`RecomputeTenantBillingState`](./docs/2.billing.md#recomputetenantbillingstate)
to refresh derived billing and workspace directory state.

A module may seed plans straight into the `db` plan table: it writes `name`, `description` and `borderLabel` with one value per locale through `localize("*")`, leaves `Plan.paymentProviderRefs` empty and never rewrites it, since dms-saas links every billed plan to Stripe itself. See [Plans and Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe#plans-and-stripe).

## Compatibility

The implementation is `@antelopejs/dms-saas >=0.6.0`. The interface declares these dependencies:

<!-- docs-compat: ./package.json#dependencies -->

| Package | Range |
| --- | --- |
| `@antelopejs/interface-data-api` | `>=0.3.0 <1.0.0` |
| `@antelopejs/interface-dms` | `>=0.8.0 <1.0.0` |

Peer dependencies:

<!-- docs-compat: ./package.json#peerDependencies -->

| Package | Range |
| --- | --- |
| `@antelopejs/interface-core` | `>=0.2.4 <1.0.0` |
| `@antelopejs/interface-database` | `>=0.1.10 <1.0.0` |
| `@antelopejs/interface-database-decorators` | `>=0.1.9 <1.0.0` |

Subpaths resolve through the `exports` map only: compile consumers with `moduleResolution` set to `bundler`, `node16` or `nodenext`. Upgrade this package together with `@antelopejs/dms-saas`; the [upgrade notes](https://dms.antelopejs.com/docs/modules/saas/faq#upgrading) cover the tenant billing page anchors and the rows written by earlier builds.

## Documentation

- [Consumer reference](./docs/1.index.md): billing, usage, lifecycle, pages, plans and database boundaries
- [Extending the SaaS module](https://dms.antelopejs.com/docs/modules/saas/extending): every extension point with examples
- [Stripe](https://dms.antelopejs.com/docs/modules/saas/stripe)
- [SaaS module guide](https://dms.antelopejs.com/docs/modules/saas)

## Contributing

This package lives in the [`AntelopeJS/dms-saas`](https://github.com/AntelopeJS/dms-saas) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-saas/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-saas#contributing) for the development commands. Release this package on its own workflow before the module that implements it.

## License

[Apache-2.0](./LICENSE)
