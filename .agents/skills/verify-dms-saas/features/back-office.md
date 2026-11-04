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
- `an-operator-resends-copies-and-revokes-a-pending-invitation`: the platform owner copies the link of a pending invitation and revokes another; a revoked invitation is gone and a second revoke is refused.
- `operator-suspension-follows-the-workspace-status`: a cancelled workspace cannot be suspended, a suspended one cannot be suspended again, only a suspended one can be reactivated, and reactivation restores it.
- `issuing-a-credit-note-without-stripe-is-refused-before-any-call`: the credit note preview and issue answer 503 saas.errors.stripe.not_configured, an invalid body is refused first, and only the platform owner may call them.
- `revenue-churn-divides-the-lost-mrr-by-the-mrr-the-period-started-with`: a workspace cancelled in the period counts the MRR it paid, the rate is lost over today's MRR plus lost, and a period before the cancellation counts none.
- `paid-invoices-sums-collected-and-credited-money-per-day-with-a-comparison`: the chart sums paid invoices and issued credit notes inside the period, ignores open ones and other currencies, and the comparison reads the earlier window.
- `grant-free-access-follows-the-plan-and-date-rules`: the grant answers each documented case: a free date in the future, a past date, an unknown plan, an unsold plan, another audience, the workspace's own plan once unsold, and a Stripe subscription that needs acknowledging.
- `complimentary-access-ending-within-7-days-is-flagged`: access granted until 5 days from now is flagged on Needs attention and under the Complimentary access ending view, one ending in 10 days is not.
- `churn-counts-a-cancellation-that-followed-a-suspension`: a paying workspace that went past due, then suspended, then cancelled still counts the MRR it paid before it fell past due.
- `a-credit-note-request-is-validated-before-stripe-is-asked`: a credit note without a reason, with an unknown reason, a fractional amount, no request id or an unknown mode is refused 400 before the 503.
- `the-workspace-plan-page-shows-the-plan-the-workspace-is-on`: after an operator moves a workspace to a plan, the workspace's own plan page names that plan and its complimentary state, not another workspace's.
- `the-workspace-list-orders-by-mrr-and-its-over-500-view-has-a-sharp-edge`: the largest MRR comes first, and the MRR over 500 view holds 501 but neither 500 nor 499.
- `the-invoice-figures-count-the-right-statuses-and-periods`: awaiting payment, collected this month, credited this month and written off this year each read their own invoices.
- `segment-money-columns-count-only-paying-workspaces-and-a-twelfth-of-a-yearly-price`: owned_mrr is 0 for a trial, a gift and a suspended workspace, and a yearly plan counts a twelfth of its price.
- `plans-by-mrr-ignores-trialing-workspaces-and-the-change-plan-list-fits-the-workspace`: a trialing workspace on a plan adds nothing to Plans by MRR, and the plans a workspace may switch to leave out those too small for its seats and those for the other audience.

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
| 4.workspaces.md Grant complimentary access (plans offered, the workspace's own plan, dates, Stripe acknowledgement) | grant journey: unknown, deleted and unsold plans, other audience, past date, own plan once unsold, open-ended grant, acknowledgement, workspace with no customer type; the plan-page journey fails on a product finding (draft dms-saas-plan-page-stale-after-operator-grant) |
| 4.workspaces.md and 3.dashboard.md complimentary accesses ending (7 days) | complimentary journey: 5 days is flagged and listed, 10 days is not |
| 3.dashboard.md Revenue churn after a suspension | churn journey: past due, suspended, cancelled in turn |
| 7.invoices.md a reason is required, amounts, request id, the three modes and six reasons | credit-note validation journey |
| 4.workspaces.md list order, views and the MRR over 500 boundary | list journey: 501 in, 500 and 499 out, largest MRR first, view counts; Not driven: Past due for more than 7 days and Owner never joined (the module sets the state date itself and a never-joined owner needs an operator-created workspace) |
| 7.invoices.md the four figures and the credit note split | figures journey: awaiting, collected, credited, written off, balance credit versus card refund |
| 5.users-and-segments.md MRR and Paying conditions (a twelfth of a yearly price, 0 for trial, gift, suspended) | segment-money journey |
| 3.dashboard.md Plans by MRR counts only paying workspaces; 2.workspace-settings.md Change plan list | plans-by-mrr journey; the Change plan dialog is checked through the plan list's size and audience fields, the filtering itself is client-side |
| 7.invoices.md which invoice statuses can be credited | Not driven: the preview answers 503 saas.errors.stripe.not_configured before it reads the invoice, so the per-status rules cannot be observed without Stripe |
| 3.dashboard.md trials ending in 14 days | dashboard-date journey: 3, 13 and 15 days, and a trial moved past the window |
| 3.dashboard.md Needs attention (past due, amount at risk, first suspension) | dashboard-date journey: count, amount, date = past-due day plus the suspension delay, and the rule changed to 30 days |
| 3.dashboard.md Workspaces by status | status journey: every billing state |
| 7.invoices.md Issue credit note without Stripe | invoice journey: 503 saas.errors.stripe.not_configured, malformed bodies 400, owner-only |
| 3.dashboard.md Revenue churn | revenue journey: churn rate = lost MRR over today's MRR plus lost, a cancelled trial that never paid counts none, a period before the cancellation counts none |
| 3.dashboard.md Paid invoices (collected, credited, comparison, No comparison) | revenue journey: paid invoices only, issued credit notes only, other statuses ignored, comparison window and delta, No comparison drops them |
| 3.dashboard.md Recent activity tabs, period selector and the refresh button | Not driven: client-side controls and activity rows written by Stripe flows |
| 4.workspaces.md row actions by status (suspend, reactivate) | operator-suspension journey: cancelled cannot be suspended, suspended cannot be suspended again, only a suspended workspace is reactivated |
| 4.workspaces.md invitations resend, copy link, revoke | invitation journey: copy link and revoke; Not driven: resend (it sends e-mail through the sink with a fresh token, not asserted) |
