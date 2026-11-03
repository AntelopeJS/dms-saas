---
covers:
  - packages/dms-saas/src/routes/tenant/index.ts
  - packages/dms-saas/src/routes/tenant/workspaces.ts
  - packages/dms-saas/src/routes/tenant/workspace-access.ts
  - packages/dms-saas/src/routes/tenant/data-export.ts
  - packages/dms-saas/src/routes/tenant/tenant-seats.ts
  - packages/dms-saas/src/routes/tenant/complimentary-banner.ts
  - packages/dms-saas/src/pages/tenant/index.ts
  - packages/dms-saas/src/pages/tenant/general.ts
  - packages/dms-saas/src/pages/tenant/data-export.ts
  - packages/dms-saas/src/workspaces/my-workspaces.ts
  - packages/dms-saas/src/workspaces/workspace-glance.ts
  - packages/dms-saas/src/workspaces/deletion*.ts
  - packages/dms-saas/src/workspaces/self-serve-creation.ts
  - packages/dms-saas/src/workspaces/invitations.ts
  - packages/dms-saas/src/workspaces/workspace-overview.ts
  - packages/dms-saas/src/workspaces/default-member-role.ts
  - packages/dms-saas/src/workspaces/complimentary-banner.ts
  - packages/dms-saas/src/workspaces/owner-invitation-email.ts
  - packages/dms-saas/src/hooks/tenant-export.ts
  - packages/dms-saas/frontend-vue/app/components/WorkspaceSwitcherWidget.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceCreateModal.vue
  - packages/dms-saas/frontend-vue/app/components/WorkspaceDangerZone.vue
  - packages/dms-saas/frontend-vue/app/components/DataExport.vue
  - packages/dms-saas/frontend-vue/app/components/DataExportHistory.vue
  - packages/dms-saas/frontend-vue/app/composables/useTenantSwitch.ts
  - packages/dms-saas/frontend-vue/app/composables/useMyWorkspaces.ts
  - packages/dms-saas/frontend-vue/app/composables/useCurrentWorkspace.ts
  - packages/dms-saas/frontend-vue/app/composables/useExportHistory.ts
  - packages/dms-saas/frontend-vue/app/composables/useWorkspaceOverview.ts
  - packages/dms-saas/frontend-vue/app/composables/useWorkspaceFinalization.ts
  - packages/dms-saas/frontend-vue/app/composables/useInvitationLink.ts
  - packages/dms-saas/frontend-vue/app/composables/useDaysLeft.ts
  - packages/dms-saas/frontend-vue/app/composables/useComplimentaryAccess.ts
  - packages/dms-saas/frontend-vue/app/build/WorkspaceSwitcherRow.vue
  - packages/dms-saas/frontend-vue/app/build/workspace-paths.ts
  - packages/dms-saas/frontend-vue/app/build/useWorkspaceName.ts
  - packages/dms-saas/frontend-vue/app/plugins/sidebar-widgets.ts
  - packages/dms-saas/src/routes/tenant/tenant-billing.ts
  - packages/dms-saas/src/routes/tenant/tenant-plan*.ts
  - packages/dms-saas/src/routes/tenant/billing-*.ts
  - packages/dms-saas/src/routes/tenant/tenant-upcoming-invoice.ts
  - packages/dms-saas/src/stripe/availability.ts
  - packages/dms-saas/src/stripe/billing-mode.ts
  - packages/dms-saas/src/stripe/client.ts
  - packages/dms-saas/src/stripe/customer-*.ts
  - packages/dms-saas/src/stripe/dashboard-links.ts
  - packages/dms-saas/src/stripe/index.ts
  - packages/dms-saas/src/stripe/pending-update.ts
  - packages/dms-saas/src/stripe/plan-schedule.ts
  - packages/dms-saas/src/stripe/proration.ts
  - packages/dms-saas/src/stripe/subscription-cancellation.ts
  - packages/dms-saas/src/stripe/sync-plan.ts
  - packages/dms-saas/src/stripe/upcoming-invoice.ts
  - packages/dms-saas/src/stripe/workspace-checkout.ts
  - packages/dms-saas/src/billing-state/**
  - packages/dms-saas/src/upcoming-invoice/**
  - packages/dms-saas/src/plan-changes/**
  - packages/dms-saas/src/pages/tenant/billing.ts
  - packages/dms-saas/src/data-api/tenant/**
  - packages/dms-saas/frontend-vue/app/components/TenantPlanCard.vue
  - packages/dms-saas/frontend-vue/app/components/TenantBillingForm.vue
  - packages/dms-saas/frontend-vue/app/components/PaymentMethodCard.vue
  - packages/dms-saas/frontend-vue/app/components/PlanUpgradeModal.vue
  - packages/dms-saas/frontend-vue/app/components/PlanComparisonModal.vue
  - packages/dms-saas/frontend-vue/app/components/PendingCheckoutModal.vue
  - packages/dms-saas/frontend-vue/app/components/CustomerPortalButton.vue
  - packages/dms-saas/frontend-vue/app/components/RefundButton.vue
  - packages/dms-saas/frontend-vue/app/components/RefundExample.vue
  - packages/dms-saas/frontend-vue/app/components/PayInvoiceModal.vue
  - packages/dms-saas/frontend-vue/app/components/PastDueBanner.vue
  - packages/dms-saas/frontend-vue/app/components/PastDueAlert.vue
  - packages/dms-saas/frontend-vue/app/components/TrialEndingBanner.vue
  - packages/dms-saas/frontend-vue/app/components/DunningTimeline.vue
  - packages/dms-saas/frontend-vue/app/components/InvoiceLines.vue
  - packages/dms-saas/frontend-vue/app/composables/useBillingStatus.ts
  - packages/dms-saas/frontend-vue/app/composables/useBillingDocumentType.ts
  - packages/dms-saas/frontend-vue/app/composables/useInvoiceLines.ts
  - packages/dms-saas/frontend-vue/app/composables/useNextInvoice.ts
  - packages/dms-saas/frontend-vue/app/composables/usePayInvoice.ts
  - packages/dms-saas/frontend-vue/app/composables/usePendingCheckout.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanChangeReview.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanDowngrade.ts
  - packages/dms-saas/frontend-vue/app/composables/useTenantPlan.ts
  - packages/dms-saas/frontend-vue/app/composables/useUpgradeAuthentication.ts
  - packages/dms-saas/frontend-vue/app/build/PlanChangeReview.vue
  - packages/dms-saas/frontend-vue/app/build/PayInvoice*.vue
  - packages/dms-saas/frontend-vue/app/build/plan-change-heading.ts
docs:
  - packages/dms-saas/docs/4.usage/2.workspace-settings.md
  - packages/dms-saas/docs/7.stripe.md
  - packages/dms-saas/docs/3.configuration.md
---

# Workspace

Settings › Workspace as the owner lives it: renaming, the workspace list, deleting a workspace, and an operator's suspension as the workspace sees it.

## Sub-features

- `an-owner-renames-the-workspace-and-sees-it-listed`: the owner renames the workspace (saved trimmed), the switcher list and the General page read the new name, and an anonymous caller cannot rename.
- `deleting-a-workspace-needs-its-name-and-revokes-access`: deletion needs the typed workspace name, answers the retention it keeps data for, and closes the workspace to its owner.
- `an-operator-suspension-closes-the-workspace-until-reactivation`: suspending needs the typed workspace name and an operation id, closes changes but keeps billing readable, repeats idempotently, and reactivation reopens it.

## How to get to it (user POV)

- Settings › Workspace › General, the workspace switcher, `/api/saas/workspaces/*`, the platform owner's suspend and reactivate actions.

## Driving it with dms-control

```bash
dms-control journey "$RUN" workspace
```

## Gotchas

- A deleted workspace stays listed with status `cancelled` and rejects changes.
- Operation ids are 8 to 64 letters, digits or hyphens.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 2.workspace-settings.md "General" | rename and deletion journeys; Not driven: members seeing the form read-only, the Danger zone layout |
| 2.workspace-settings.md "Workspace switcher" | rename journey reads the list; Not driven: search by name or owner, Create workspace with a card (Stripe) |
| 2.workspace-settings.md "Billing" | smoke reads the plan; Not driven: Next invoice, payment method, billing information, Pay invoice, Change plan, Manage in Stripe (all call Stripe) |
| 2.workspace-settings.md "Data export" | Not driven: the export job e-mails a link; no journey drives the background archive |
| 7.stripe.md "Starting a paid plan" | Not driven: Checkout needs Stripe |
| 8.operations.md "Operator actions" | suspension journey: confirmation, operation id format, idempotent repeat, mismatch 409; Not driven: reconciliation_required after 23 hours, upgrades and balance credits (Stripe) |
