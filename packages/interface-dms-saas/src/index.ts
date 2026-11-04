/**
 * Main entry of the DMS SaaS interface.
 *
 * `./invoice-line-items` and `./tenant-lifecycle` arrive as namespaces
 * rather than flat re-exports: each exposes an `internal` proxy namespace, and
 * two `internal` names cannot coexist in one barrel. Their own subpaths remain
 * the direct route to the same symbols.
 *
 * `./db` stays out entirely. Importing it registers the SaaS tables, and a
 * consumer that only wants types should not pay for that.
 */
export * from "./billing";
export * from "./data-api";
export * from "./json";
export * from "./pages";
export * from "./plans";
export * from "./provisioning";
export * from "./registration";
export * as invoiceLineItems from "./invoice-line-items";
export * as tenantLifecycle from "./tenant-lifecycle";
export * as planChanges from "./plan-changes";
