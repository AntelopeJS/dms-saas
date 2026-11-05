---
covers:
  - packages/dms-saas/src/index.ts
  - packages/dms-saas/src/routes/index.ts
  - packages/dms-saas/src/routes/tenant/tenant-plan.ts
  - packages/dms-saas/frontend-vue/build/backend-boundary.ts
  - packages/dms-saas/src/frontend-module.ts
  - packages/dms-saas/src/db/**
  - packages/dms-saas/src/automation/**
  - packages/dms-saas/src/hooks/index.ts
  - packages/dms-saas/src/hooks/register.ts
  - packages/dms-saas/src/i18n/**
  - packages/dms-saas/src/utils/**
  - packages/dms-saas/frontend-vue/dms.frontend.ts
  - packages/dms-saas/frontend-vue/dms.frontend.build.ts
  - packages/dms-saas/frontend-vue/dms.server.ts
  - packages/dms-saas/frontend-vue/i18n/**
  - packages/dms-saas/frontend-vue/app/types/**
  - packages/dms-saas/frontend-vue/app/build/.gitkeep
  - packages/dms-saas/frontend-vue/app/build/day-formats.ts
  - packages/dms-saas/frontend-vue/app/build/highlight.ts
  - packages/dms-saas/frontend-vue/app/composables/useMountedData.ts
  - packages/dms-saas/frontend-vue/app/composables/useOnDemandRead.ts
  - packages/dms-saas/frontend-vue/app/composables/useApiErrorMessage.ts
  - packages/dms-saas/frontend-vue/app/composables/useMoneyFormat.ts
  - packages/dms-saas/frontend-vue/app/components/LoadFailure.vue
  - packages/dms-saas/frontend-vue/app/plugins/billing-data-types.ts
docs:
  - packages/dms-saas/docs/1.introduction.md
  - packages/dms-saas/docs/2.installation.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the installation page's "Start with one free workspace".

## Sub-features

- `smoke`: a visitor registers without a card, lands in a workspace on the free plan, and sees that plan on the Billing page.

## How to get to it (user POV)

- Modules › SaaS › Plans publishes the free plan; `/register` opens the workspace; Settings › Workspace › Billing shows the plan.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```

## Gotchas

- The free plan lists the permissions the owner gets: a plan with none leaves the owner without any page, so the journey publishes a plan holding every permission of the editor's tree (`allPermissionIds`).
- The playground keeps placeholder Stripe keys, so the module makes no Stripe call and registration applies the `none` card policy.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 2.installation.md "Start with one free workspace" / 1.introduction.md | smoke: the plan is the free plan, status active, the Billing page shows it |
| 1.introduction.md "Who uses each surface" | Not driven: the pricing and legal pages are driven by `public` and `billing-rules`; Settings pages by `workspace` |
