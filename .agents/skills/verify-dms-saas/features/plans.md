---
covers:
  - packages/dms-saas/src/routes/platformOwner/plans.ts
  - packages/dms-saas/src/routes/platformOwner/plan-dialogs.ts
  - packages/dms-saas/src/plans/plan-permission-tree.ts
  - packages/dms-saas/src/plans/money.ts
  - packages/dms-saas/src/plans/feature-usage.ts
  - packages/dms-saas/src/plans/plan-diff.ts
  - packages/dms-saas/src/plans/plan-audience.ts
  - packages/dms-saas/src/plans/plan-write.ts
  - packages/dms-saas/src/plans/stripe-sync.ts
  - packages/dms-saas/src/plans/catalogue-summary.ts
  - packages/dms-saas/src/plans/catalogue-usage.ts
  - packages/dms-saas/src/plans/index.ts
  - packages/dms-saas/src/plans/plan-access-type.ts
  - packages/dms-saas/src/pages/platform/features.ts
  - packages/dms-saas/src/pages/platform/paths.ts
  - packages/dms-saas/src/pages/platform/categories.ts
  - packages/dms-saas/src/pages/platform/index.ts
  - packages/dms-saas/src/pages/platform/plans/index.ts
  - packages/dms-saas/src/pages/platform/plans/edit.ts
  - packages/dms-saas/src/data-api/index.ts
  - packages/dms-saas/src/data-api/platformOwner/index.ts
  - packages/dms-saas/src/data-api/platformOwner/plans.ts
  - packages/dms-saas/src/data-api/platformOwner/features.ts
  - packages/dms-saas/src/workspaces/default-plan.ts
  - packages/dms-saas/frontend-vue/app/components/PlanCard.vue
  - packages/dms-saas/frontend-vue/app/components/PlanEditorPreview.vue
  - packages/dms-saas/frontend-vue/app/components/PlanAccessEditor.vue
  - packages/dms-saas/frontend-vue/app/components/PlanLimitInput.vue
  - packages/dms-saas/frontend-vue/app/components/PlanTaxSync.vue
  - packages/dms-saas/frontend-vue/app/build/plan-catalog.ts
  - packages/dms-saas/frontend-vue/app/build/plan-permissions.ts
  - packages/dms-saas/frontend-vue/app/build/PlanPermissionPicker.vue
  - packages/dms-saas/frontend-vue/app/build/PlanFeatureValueInput.vue
  - packages/dms-saas/frontend-vue/app/composables/usePlanCatalog.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanFeatureFormat.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanIntervalLabel.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanPriceLabel.ts
  - packages/dms-saas/frontend-vue/app/composables/usePlanComparison.ts
  - packages/dms-saas/src/routes/platformOwner/plan-deletion.ts
  - packages/dms-saas/src/routes/platformOwner/plan-migrations.ts
  - packages/dms-saas/src/routes/platformOwner/plan-migration-export.ts
  - packages/dms-saas/src/routes/platformOwner/plan-migration-context.ts
  - packages/dms-saas/src/workers/**
  - packages/dms-saas/src/plans/migration-*.ts
  - packages/dms-saas/src/pages/platform/plans/migrations.ts
  - packages/dms-saas/src/data-api/platformOwner/plan-migrations.ts
  - packages/dms-saas/frontend-vue/app/components/RetirePlanModal.vue
  - packages/dms-saas/frontend-vue/app/components/MigrationStripeCheck.vue
  - packages/dms-saas/frontend-vue/app/build/plan-retire.ts
  - packages/dms-saas/frontend-vue/app/build/components/RetirePlanDiff.vue
docs:
  - packages/dms-saas/docs/4.usage/6.plans.md
  - packages/dms-saas/docs/3.configuration.md
  - packages/dms-saas/docs/5.extending.md
  - packages/dms-saas/docs/8.operations.md
---

# Plans

The plan catalogue the platform owner edits: plan writes with their validation and defaults, paid plans that cannot sync without Stripe, stopping the sale, deleting an unused plan, retiring a plan into a target, and who may write.

## Sub-features

- `a-plan-write-is-validated-and-defaulted`: a plan gets its slug from its name, trimmed texts, the documented defaults and the next order, and bad intervals and member caps are refused.
- `a-paid-plan-is-saved-but-not-payable-without-stripe`: a priced plan is saved with the not-synced notice and is not offered as payable to a workspace.
- `stop-selling-moves-nobody-and-delete-needs-an-empty-plan`: taking a plan off sale keeps its workspaces on it, and a plan with a workspace cannot be deleted until it is empty.
- `retiring-a-plan-needs-its-slug-and-an-active-target`: retiring a plan needs its slug typed and an active target other than itself, and the impact counts the workspaces on it.
- `a-retired-plans-workspaces-move-and-the-plan-can-then-go`: a started retirement closes the plan to sign-ups, moves its workspaces to the target, and the plan is then deletable.
- `only-the-platform-owner-edits-the-catalogue`: a workspace owner and an anonymous caller cannot write, delete or retire plans.
- `every-text-field-of-a-plan-is-saved-trimmed`: name, description and badge are saved trimmed on create and on save, and a save of one text keeps the others.

## How to get to it (user POV)

- Modules › SaaS › Catalogue › Plans (`/modules/saas/catalog/plans`), the plan editor, Retire plan…, `/api/saas/plans`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" plans
```

## Gotchas

- Known finding: `a-retired-plans-workspaces-move-and-the-plan-can-then-go` fails because the migration job aborts at start with "Atomic mutation patches must contain constant data" (draft `dms-saas-plan-migration-atomic-patch`).
- A plan priced above 0 is saved with the `stripe_not_synced` notice; the placeholder key skips every sync.
- `audience: "nobody"` is accepted by the API (not documented as validated, so a note, not a check).

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 6.plans.md "Plans" (cards, tabs, stop selling, delete) | stop-selling journey; Not driven: card layout, drag reordering, the tabs On sale / Legacy / All and their figures |
| 6.plans.md "Plan editor" | plan-write journey (identity, pricing fields, member cap, defaults); Not driven: Live preview, Stripe sync state card, permission tree ticking (driven in `gating` through the API) |
| 6.plans.md "Features" | Not driven: the features catalogue page (no journey creates features) |
| 6.plans.md "Plan migrations" | retire journeys; the migration itself is a known finding; Not driven: the Live/Pause switch, Retry failed workspaces, Mark as reconciled, Export CSV |
| 7.stripe.md "Plans and their Stripe products" | paid-plan journey (notice and not payable); Not driven: product/price creation, idempotency keys, the tax-code resync (all need Stripe) |
| 8.operations.md "Plan migrations" | Not driven: capture, outcomes, retry, reconcile and resolve need a migration job that starts (blocked by the finding) |
| 5.extending.md "Plan feature labels and values" | Not driven: localized feature rows are written by modules through `localize("*")` |
| 6.plans.md Text fields are saved trimmed | plan-text journey: name, description, badge and slug trimmed on create and save |
