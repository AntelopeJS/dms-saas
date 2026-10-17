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

- dms-saas 0.6 requires `@antelopejs/dms` >=0.9 (interface-dms 0.7, renderer `@antelopejs/dms-frontend` 0.6);
  0.5 is the DMS 0.8 line.
- `ajs project modules add @antelopejs/dms-saas`; config `stripe.{secretKey,publishableKey,webhookSecret}` from env
  (`envOverrides`). Placeholder keys disable Stripe calls (plan sync skipped).
- Stripe webhook endpoint → `/api/saas/webhooks/stripe`, API version `2026-08-26.dahlia`.
- Frontend server env: `DMS_AUTH_ESTABLISH_ENDPOINTS=/api/saas/register/finalize`, else sign-ups stay signed out (403).
- `allowedRedirectHosts` for Checkout / billing-portal return URLs (loopback auto-allowed in dev only).
- A free plan must exist (or `defaultPlanSlug`): registration opens it, and every workspace without a subscription gets it.
- Options: `admissionMode` (`open` | `invitation-only`), `registration.paymentMethod` (`required` default | `optional` | `none`),
  `publicScreens.{register,pricing}`, `upcomingInvoicePreviewCacheTtlSeconds`, `reportingCurrency`,
  `stripe.readTimeoutMs` (4000; Stripe reads a page renders) and `stripe.readMaxNetworkRetries` (0).

## Plans gate permissions

- The `dms-saas.plan-intersection` resolver keeps, per member, roles ∩ plan; the workspace owner gets every plan
  permission (never `*`). A plan grants exactly the ids it lists: list every component id, not just the page.
- New project page or block → add its permission ids to the plans that should get it, or tenants lose it.
- Seeding plans from code: write name, price, currency, interval, billing mode; leave `paymentProviderRefs` to dms-saas.
- Features: `displayName` / `tooltip` are localized (`{ en, fr }` + `.localize("*")`), never i18n keys.

## Extension points (`@antelopejs/interface-dms-saas`)

| Need | API |
| --- | --- |
| Own registration screen | `publicScreens.register: false` + `useSaasRegistration()` composable |
| Store sign-up answers | `extras` on the payload + `Hook.TENANT_BEING_PROVISIONED` listener (throwing cancels the sign-up; return `undefined`) |
| Bill metered usage | `RegisterInvoiceLineItemsProvider({ id, resolve })` in `construct`, unregister in `stop`; stable `key`s |
| Show tax-exact next invoice | `GetUpcomingInvoicePreview({ tenantId, userId })` → `available` / `absent` / `unavailable` |
| Page in workspace settings | `category: workspaceSettingsCategory` (from `/pages`) |
| Block on the billing page | `RegisterTenantBillingPageExtension({ name, components })` anchored on `tenantBillingPage.components.*` |
| React to create/suspend/reactivate | `RegisterTenantLifecycleConsumer` from `/tenant-lifecycle` (root namespace `tenantLifecycle`); dedupe by `operationId`; gate on `IsTenantProvisioningCommitted` |

Pages you add stay backend-declared blocks; only the missing block is a `CustomComponent`, with `.meta({ name, description, icon })`.

## Gotchas

- `reconciliation_required` (operator actions, migrations, webhooks) is deliberate: never delete records or replay blindly.
- Checkout errors: `422 checkout_rejected` (retry), `503 checkout_unavailable`, `409 checkout_in_progress`.
- Upgrading old databases needs manual row fixes (`isComplimentary`, `documentType`, `revision`, `paidUsagePeriods`, localized features).
- Passwords follow the DMS policy: letters, digits and `@$!%*?&` only.
