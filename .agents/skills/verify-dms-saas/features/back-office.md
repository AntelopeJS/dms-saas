---
covers:
  - packages/dms-saas/src/routes/platformOwner/workspace-detail.ts
  - packages/dms-saas/src/routes/platformOwner/workspaces-admin.ts
  - packages/dms-saas/src/routes/platformOwner/workspace-operator-actions.ts
  - packages/dms-saas/src/routes/platformOwner/workspace-invitations.ts
  - packages/dms-saas/src/routes/platformOwner/platform-notes.ts
  - packages/dms-saas/src/routes/platformOwner/block-payloads.ts
  - packages/dms-saas/src/routes/platformOwner/index.ts
  - packages/dms-saas/src/operator-actions/commands.ts
  - packages/dms-saas/src/operator-actions/journal.ts
  - packages/dms-saas/src/operator-actions/one-shot.ts
  - packages/dms-saas/src/operator-actions/previews.ts
  - packages/dms-saas/src/operator-actions/upgrade-preview.ts
  - packages/dms-saas/src/operator-actions/types.ts
  - packages/dms-saas/src/operator-actions/invitation-commands.ts
  - packages/dms-saas/src/operator-actions/index.ts
  - packages/dms-saas/src/operator-actions/db/index.ts
  - packages/dms-saas/src/operator-actions/db/operator-action.*
  - packages/dms-saas/src/workspaces/operator-creation.ts
  - packages/dms-saas/src/workspaces/operator-view.ts
  - packages/dms-saas/src/workspaces/complimentary.ts
  - packages/dms-saas/src/workspaces/suspension.ts
  - packages/dms-saas/src/workspaces/detail-items.ts
  - packages/dms-saas/src/pages/platform/workspaces/**
  - packages/dms-saas/src/data-api/platformOwner/workspaces.ts
  - packages/dms-saas/src/data-api/platformOwner/workspace-cells.ts
  - packages/dms-saas/src/data-api/platformOwner/members.ts
  - packages/dms-saas/src/data-api/platformOwner/invitations.ts
  - packages/dms-saas/src/data-api/platformOwner/table-scope.ts
  - packages/dms-saas/src/data-api/platformOwner/hidden-filter.ts
  - packages/dms-saas/frontend-vue/app/components/WorkspaceAdminCreateModal.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceDetailHeader.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceOperatorActions.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceSuspendButton.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceInvitationLink.vue
  - packages/dms-saas/frontend-vue/app/components/PlatformNotes.vue
  - packages/dms-saas/frontend-vue/app/build/workspace-detail/**
  - packages/dms-saas/src/routes/platformOwner/dashboard.ts
  - packages/dms-saas/src/routes/platformOwner/billing-stats.ts
  - packages/dms-saas/src/metrics/**
  - packages/dms-saas/src/pages/platform/dashboard.ts
  - packages/dms-saas/src/operator-billing/billing-stats.ts
  - packages/dms-saas/frontend-vue/app/build/period-range.ts
  - packages/dms-saas/src/routes/platformOwner/credit-notes-issue.ts
  - packages/dms-saas/src/routes/platformOwner/stripe-dashboard.ts
  - packages/dms-saas/src/operator-billing/credit-allowance.ts
  - packages/dms-saas/src/operator-billing/credit-note-request.ts
  - packages/dms-saas/src/operator-billing/invoice-credit.ts
  - packages/dms-saas/src/pages/platform/invoices.ts
  - packages/dms-saas/src/pages/platform/credit-notes.ts
  - packages/dms-saas/src/data-api/platformOwner/invoice*.ts
  - packages/dms-saas/src/data-api/platformOwner/credit-note*.ts
  - packages/dms-saas/frontend-vue/app/components/IssueCreditNoteModal.vue
  - packages/dms-saas/frontend-vue/app/build/composables/**
  - packages/dms-saas/frontend-vue/app/build/components/CreditNoteInvoiceSummary.vue
  - packages/dms-saas/frontend-vue/app/build/components/FormRows.vue
  - packages/dms-saas/frontend-vue/app/build/components/FormFieldRow.vue
  - packages/dms-saas/frontend-vue/app/build/components/RequiredLegend.vue
docs:
  - packages/dms-saas/docs/4.usage/4.workspaces.md
  - packages/dms-saas/docs/8.operations.md
  - packages/dms-saas/docs/4.usage/3.dashboard.md
  - packages/dms-saas/docs/4.usage/7.invoices.md
---

# Back Office

The platform owner's dashboard: the headline figures, the workspaces by status and the plans by MRR, computed from workspaces in every billing state, the reporting currency, and who may read them.

## Sub-features

- `the-headline-figures-normalise-and-count-only-paying-workspaces`: MRR counts a yearly plan for a twelfth and counts active and past-due paid workspaces, never trials, gifts or free ones.
- `mrr-is-reported-in-the-configured-currency-only`: with a reporting currency other than the plans' currency MRR shows 0 for them (never converted), and the code is read in upper case.
- `only-the-platform-owner-reads-the-dashboard`: a workspace owner and an anonymous caller are refused every dashboard block.
- `trials-ending-within-14-days-are-flagged-and-later-ones-are-not`: the headline counts every trial and flags those that end within 14 days: 13 days is flagged, 15 days is not.
- `needs-attention-shows-past-due-workspaces-with-the-amount-and-first-suspension`: Needs attention counts the past-due workspaces, the amount at risk and the first suspension date: past-due day plus the suspension delay.
- `workspaces-by-status-counts-every-billing-state`: past-due, suspended, pending-payment, cancelled, trialing and free workspaces each land in their own count.
- `issuing-a-credit-note-without-stripe-is-refused-before-any-call`: the credit note preview and issue answer 503 saas.errors.stripe.not_configured, an invalid body is refused first, and only the platform owner may call them.

## How to get to it (user POV)

- Modules › SaaS › Dashboard (`/modules/saas/overview/dashboard`), `/api/saas/dashboard/*`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" back-office
```

## Gotchas

- Subscriptions in paid states are written through the fixture (`POST /verify-saas/subscription`) with the module's own model, then the workspace is republished with `RecomputeTenantBillingState`, as the docs tell a seed to do.
- A complimentary workspace counts as free in the headline and the status counts.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 3.dashboard.md headline figures | dashboard headline journey: MRR/ARR normalisation, paying out of all, free and trialing |
| 3.dashboard.md "Workspaces by status", "Plans by MRR" | dashboard headline journey |
| 3.dashboard.md reporting currency | reporting-currency journey |
| 3.dashboard.md Needs attention, Revenue churn, Paid invoices, Recent activity, period and comparison | Not driven: no journey seeds invoices, cancellations or dated events |
| 4.workspaces.md list, views, tabs, detail, operator actions | Not driven except suspension and reactivation (workspace feature): the list and detail pages are data tables rendered by the dashboard |
| 7.invoices.md invoices, credit notes, issuing | Not driven: invoices are mirrored from Stripe; issuing a credit note answers 503 saas.errors.stripe.not_configured without a key but no journey asserts it yet |
| 3.dashboard.md trials ending in 14 days | dashboard-date journey: 3, 13 and 15 days, and a trial moved past the window |
| 3.dashboard.md Needs attention (past due, amount at risk, first suspension) | dashboard-date journey: count, amount, date = past-due day plus the suspension delay, and the rule changed to 30 days |
| 3.dashboard.md Workspaces by status | status journey: every billing state |
| 7.invoices.md Issue credit note without Stripe | invoice journey: 503 saas.errors.stripe.not_configured, malformed bodies 400, owner-only |
| 3.dashboard.md Revenue churn, Paid invoices, comparison menu, Recent activity | Not driven: churn and paid invoices need paid invoice rows mirrored from Stripe, and the comparison and period controls are client state |
