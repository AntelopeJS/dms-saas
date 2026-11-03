---
covers:
  - packages/interface-dms-saas/src/**
  - packages/dms-saas/src/implementations/**
  - packages/dms-saas/src/invoice-line-items/**
  - packages/dms-saas/src/operator-actions/lifecycle-consumers.ts
  - packages/dms-saas/src/operator-actions/lifecycle-outbox.ts
  - packages/dms-saas/src/operator-actions/db/lifecycle-delivery.*
docs:
  - packages/interface-dms-saas/docs/1.index.md
  - packages/interface-dms-saas/docs/2.billing.md
  - packages/interface-dms-saas/docs/3.lifecycle-and-usage.md
  - packages/interface-dms-saas/docs/4.pages-plans-data.md
  - packages/dms-saas/docs/5.extending.md
---

# Interface

The billing reads of `@antelopejs/interface-dms-saas` as a consuming module calls them: customer balance, upcoming invoice preview, billing period, and the membership check.

## Sub-features

- `the-billing-reads-answer-absent-for-a-free-and-a-gifted-workspace`: balance and upcoming invoice preview answer absent with the documented reason, the billing period is null, and a non-member is refused.

## How to get to it (user POV)

- A module imports the functions from `@antelopejs/interface-dms-saas/billing`; the fixture controller calls them.

## Driving it with dms-control

```bash
dms-control journey "$RUN" interface
```

## Gotchas

- The fixture returns `{ ok, result }` or `{ ok: false, rejection }`.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 2.billing.md GetTenantCustomerBalance | interface journey: absent for free and gifted; Not driven: available balance, currency_unavailable, customer_deleted, 502 provider failures (Stripe) |
| 2.billing.md GetUpcomingInvoicePreview | interface journey: absent free_plan and complimentary, unavailable stripe_not_configured, membership refusal; Not driven: available preview, tax reasons, cache |
| 2.billing.md GetTenantBillingPeriod | interface journey: null for free, gifted and unrecorded periods |
| 2.billing.md RecomputeTenantBillingState | used by every seeded journey (dashboard, people) |
| 3.lifecycle-and-usage.md invoice line items, plan changes, tenant lifecycle, registration and provisioning | registration extras and the provisioning hook are driven in `public`; Not driven: line item providers, plan change policies and lifecycle consumers (need invoices and transitions the harness cannot produce) |
| 4.pages-plans-data.md page extensions, plan helpers, HiddenStringFilter, db exports | Not driven: extension registration is a build-time contract checked by `check:exports` and the repository tests |
