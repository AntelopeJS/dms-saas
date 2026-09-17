# @antelopejs/interface-dms-saas

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Public interfaces of the AntelopeJS DMS SaaS module.

A module that extends `@antelopejs/dms-saas` depends on this package rather than
on the runtime, and imports the extension points from it:

| Subpath | Surface |
| --- | --- |
| `@antelopejs/interface-dms-saas` | every extension point except `db`: billing, data API, pages, plans, provisioning and registration flat, plus the `invoiceLineItems` and `workspaceLifecycle` namespaces |
| `@antelopejs/interface-dms-saas/billing` | customer balance and complimentary subscription state |
| `@antelopejs/interface-dms-saas/data-api` | hidden-value data API filters |
| `@antelopejs/interface-dms-saas/db` | canonical SaaS tables and data models |
| `@antelopejs/interface-dms-saas/hidden-filter` | the `HiddenStringFilter` decorator on its own |
| `@antelopejs/interface-dms-saas/invoice-line-items` | provider registration, line item types, line key helpers |
| `@antelopejs/interface-dms-saas/page-definitions` | page and module ids, slugs and descriptors |
| `@antelopejs/interface-dms-saas/pages` | workspace settings category and tenant billing page extensions |
| `@antelopejs/interface-dms-saas/plans` | plan projections, catalog builder, and price normalization |
| `@antelopejs/interface-dms-saas/provisioning` | provisioning hook payload |
| `@antelopejs/interface-dms-saas/registration` | public registration capture limits |
| `@antelopejs/interface-dms-saas/workspace-lifecycle` | workspace lifecycle events and operator actions |

Two of those surfaces reach the root entry as namespaces rather than flat
re-exports, because each exposes an `internal` proxy namespace and two
`internal` names cannot coexist in one barrel:

```ts
import { invoiceLineItems, workspaceLifecycle } from "@antelopejs/interface-dms-saas";

invoiceLineItems.RegisterInvoiceLineItemsProvider(/* … */);
```

Their own subpaths stay the direct route to the same symbols. `./db` is the one
surface the root entry leaves out: importing it registers the SaaS tables, and a
consumer that only wants types should not pay for that.

The `exports` map also carries a types-only `./dist/...` twin of every subpath.
Nothing should import those: they exist because TypeScript's declaration emit
rewrites `<pkg>/db/tables/plans.table` into the `dist` path it resolved through
`typesVersions`, and an exports-aware consumer of the emitted `.d.ts` has to be
able to resolve that path back.

This package is released on its own workflow and must be published before the
runtime module: `@antelopejs/dms-saas` depends on it through
`>=<interface version> <1.0.0`, a range that only resolves once this package is
released.
