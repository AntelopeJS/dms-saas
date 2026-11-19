/** The source globs the `gating` feature of `e2e/journeys/` owns. */
export const covers = [
  "packages/dms-saas/src/auth/plan-permissions-resolver.ts",
  "packages/dms-saas/src/auth/owner-only-permissions-resolver.ts",
  "packages/dms-saas/src/auth/subscription-access-gate.ts",
  "packages/dms-saas/src/auth/index.ts",
  "packages/dms-saas/src/plans/seat-*.ts",
  "packages/dms-saas/src/plans/feature-guards.ts",
  "packages/dms-saas/src/plans/platform-support.ts",
  "packages/dms-saas/src/pages/tenant/members-seat-quota.ts",
  "packages/dms-saas/src/pages/tenant/owner-only.ts",
  "packages/dms-saas/src/pages/tenant/workspace-suspended.ts",
  "packages/dms-saas/frontend-vue/app/components/WorkspaceSuspended.vue",
  "packages/dms-saas/frontend-vue/app/components/SeatQuotaBanner.vue",
  "packages/dms-saas/frontend-vue/app/composables/useSeatQuota.ts",
  "packages/dms-saas/frontend-vue/app/composables/useSubscriptionAccess.ts",
  "packages/dms-saas/frontend-vue/app/composables/useSaasStatus.ts",
];
