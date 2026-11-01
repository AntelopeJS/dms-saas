---
name: dms-saas
description: Turns an AntelopeJS DMS project into a SaaS with the @antelopejs/dms-saas module. Use when installing or configuring dms-saas (Stripe keys, webhooks, registration card policy, admission mode, default plan), gating features by plan permissions, seeding plans or features, extending it through @antelopejs/interface-dms-saas (registration extras, invoice line items, upcoming invoice preview, workspace settings pages, billing page blocks, lifecycle consumers), or debugging sign-up, checkout, plan sync or reconciliation errors.
icon: i-lucide-building-2
category: billing
tags: [saas, billing, stripe, plans, subscriptions, multi-tenant, dms-module]
---

# dms-saas

Self-service sign-up, plans, Stripe billing, customer workspace settings and an owner back office (`/modules/saas/...`).
User docs: `docs/` of this package, published at https://dms.antelopejs.com/docs/modules/saas
(`configuration`, `extending`, `stripe`, `operations`, `faq#upgrading`).

## Setup checklist

- Requires `@antelopejs/dms` >=0.13.1 (interface-dms 0.9, renderer `@antelopejs/dms-frontend` 0.9).
- `ajs project modules add @antelopejs/dms-saas`; config `stripe.{secretKey,publishableKey,webhookSecret}` from env
  (`envOverrides`). Placeholder keys disable Stripe calls: plan sync skipped, registration
  takes no card whatever `registration.paymentMethod` says. Stripe refusing the key or unreachable → handled
  `503 saas.errors.stripe.unavailable`, not a 500. A new route that calls Stripe wraps its calls in
  `withStripeAvailability()` and, when it cannot work without Stripe, calls `assertStripeConfigured()` first
  (`503 saas.errors.stripe.not_configured`) — see `src/stripe/availability.ts`.
- Stripe webhook endpoint → `/api/saas/webhooks/stripe`, API version `2026-08-26.dahlia`.
- Frontend server env: `DMS_AUTH_ESTABLISH_ENDPOINTS=/api/saas/register/finalize`, else sign-ups stay signed out (403).
- `allowedRedirectHosts` for Checkout / billing-portal return URLs: defaults to the DMS `clientBaseUrl` host, a value replaces it (loopback auto-allowed in dev only).
- A free plan must exist (or `defaultPlanSlug`): registration opens it, and every workspace without a subscription gets it.
- Options: `admissionMode` (`open` | `invitation-only`), `registration.paymentMethod` (`required` default | `optional` | `none`),
  `publicScreens.{register,pricing}`, `upcomingInvoicePreviewCacheTtlSeconds`, `reportingCurrency`,
  `stripe.readTimeoutMs` (4000; Stripe reads a page renders) and `stripe.readMaxNetworkRetries` (0).

## Plans gate permissions

- The `dms-saas.plan-intersection` resolver keeps, per member, roles ∩ plan; the workspace owner gets every plan
  permission (never `*`). A plan grants exactly the ids it lists: list every component id, not just the page.
- Role preview (`context.preview` in a resolver): roles ∩ plan with no owner grant and no owner-only screens, `*` kept
  only for a `*` role. Resolvers of your own keyed on the user must read the context the same way.
- New project page or block → add its permission ids to the plans that should get it, or tenants lose it.
- Seeding plans from code: write name, price, currency, interval, billing mode; leave `paymentProviderRefs` to dms-saas.
  `name`, `description` and `borderLabel` are localized (`{ en, fr }` + `.localize("*")`), never i18n keys; Stripe gets the `en` text.
- Features: `displayName` / `tooltip` are localized (`{ en, fr }` + `.localize("*")`), never i18n keys.
- Plan `description` and `borderLabel` may be `$i18n.key` (translated on every screen); `name` stays plain text.

## Extension points (`@antelopejs/interface-dms-saas`)

| Need | API |
| --- | --- |
| Own registration screen | `publicScreens.register: false` + `useSaasRegistration()` composable |
| Store sign-up answers | `extras` on the payload + `Hook.TENANT_BEING_PROVISIONED` listener (throwing cancels the sign-up; return `undefined`) |
| Bill metered usage | `RegisterInvoiceLineItemsProvider({ id, resolve })` in `construct`, `UnregisterInvoiceLineItemsProvider(id)` in `stop`, both from `@antelopejs/interface-dms-saas/invoice-line-items` (the root only exposes them as the `invoiceLineItems` namespace); stable `key`s |
| Show tax-exact next invoice | `GetUpcomingInvoicePreview({ tenantId, userId })` → `available` / `absent` / `unavailable` |
| Page in workspace settings | `category: workspaceSettingsCategory` (from `/pages`) |
| Block on the billing page | `RegisterTenantBillingPageExtension({ name, components })` anchored on `tenantBillingPage.components.*` |
| React to create/suspend/reactivate | `RegisterTenantLifecycleConsumer` from `/tenant-lifecycle` (root namespace `tenantLifecycle`); dedupe by `operationId`; gate on `IsTenantProvisioningCommitted` |

Pages you add stay backend-declared blocks; only the missing block is a `CustomComponent`, with `.meta({ name, description, icon })`.
A page with a period or live data opens with the DMS page toolbar (`pageToolbar()` / `PageToolbar()` from
`@antelopejs/interface-dms/base`), as the dashboard (period, `rememberKey: "saas"`, no `live`) and the migration detail (`live`, no period) do.
A period with figures to compare offers `comparisons: ["previous-period", "previous-year", "none"]` (through `pageToolbar()`, several comparisons give the menu on `"previous-period"` by default: set neither `defaultComparison` nor `comparisonControl`); its routes read the window from `compareFrom` / `compareTo` (`readPeriodQuery`), lay comparison series on the current buckets, and send no delta for `comparison=none`.

## Gotchas

- `reconciliation_required` (operator actions, migrations, webhooks) is deliberate: never delete records or replay blindly.
- Stripe is the only billing path: demos and tests use a Stripe **test** account (`sk_test_`/`pk_test_`) with webhooks
  forwarded (`stripe listen --forward-to localhost:5010/api/saas/webhooks/stripe`). Webhooks move checkout → active,
  trial end, failed and recovered payments, cancellation; nothing else advances a trial or a renewal.
- Without webhooks only the crons move states: 01:00 past due → suspended after `autoSuspendDelayDays` (14) from
  `pastDueSince`; 02:00 complimentary `freeUntil` passed → past due; 04:30 cancelled → workspace **and data deleted**
  `dataRetentionDaysAfterCancellation` (30) days after the subscription's last write (`updatedAt`).
- Direct table seeds (like the playground): keep dates relative to now, an `active` row without `stripeSubscriptionId`
  is free (0 MRR), fake Stripe ids make Stripe-calling actions fail; call `RecomputeTenantBillingState(tenantId)` after.
  A workspace first published already cancelled counts churn only when it has a paid invoice above 0.
- Checkout errors: `422 checkout_rejected` (retry), `503 checkout_unavailable`, `409 checkout_in_progress`.
- Upgrading old databases needs manual row fixes (`isComplimentary`, `documentType`, `revision`, `paidUsagePeriods`, localized features).
- Passwords follow the DMS policy: letters, digits and `@$!%*?&` only.
