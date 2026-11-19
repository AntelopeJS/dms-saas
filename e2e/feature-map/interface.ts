/** The source globs the `interface` feature of `e2e/journeys/` owns. */
export const covers = [
  "packages/interface-dms-saas/src/**",
  "packages/dms-saas/src/implementations/**",
  "packages/dms-saas/src/invoice-line-items/**",
  "packages/dms-saas/src/operator-actions/lifecycle-consumers.ts",
  "packages/dms-saas/src/operator-actions/lifecycle-outbox.ts",
  "packages/dms-saas/src/operator-actions/db/lifecycle-delivery.*",
];
