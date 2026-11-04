import { defineScenes } from "@antelopejs/tooling-configs/capture";

/**
 * The screenshots of the dms-saas docs, taken on the Helio demo. The onboarding
 * runs first and creates the administrator every signed-in scene uses. All
 * scenes share one browser session, so `login` signs out and only public
 * screens follow it.
 */
export default defineScenes([
  {
    id: "onboarding",
    route: "/onboarding",
    setup: true,
    steps: [
      { action: "fill", selector: 'input[name="name"]', value: "Helio" },
      {
        action: "click",
        selector: 'button:has-text("Continue to administrator")',
      },
      { action: "wait", selector: 'input[name="firstName"]' },
      { action: "fill", selector: 'input[name="firstName"]', value: "Sophie" },
      { action: "fill", selector: 'input[name="lastName"]', value: "Lambert" },
      {
        action: "fill",
        selector: 'input[name="email"]',
        value: "sophie.lambert@helio.be",
      },
      {
        action: "fill",
        selector: 'input[name="password"]',
        value: "HelioDocs2026!",
      },
      {
        action: "click",
        selector: 'button:has-text("Create administrator account")',
      },
      { action: "wait", selector: 'button:has-text("Open the dashboard")' },
      { action: "click", selector: 'button:has-text("Open the dashboard")' },
    ],
  },
  {
    id: "dashboard",
    route: "/modules/saas/overview/dashboard",
    output: "packages/dms-saas/docs/images/captures/dashboard.webp",
  },
  {
    id: "workspaces",
    route: "/modules/saas/customers/workspaces",
    output: "packages/dms-saas/docs/images/captures/workspaces.webp",
  },
  {
    id: "workspace-detail",
    route: "/modules/saas/customers/workspaces/helio-ws-solaris-hainaut",
    output: "packages/dms-saas/docs/images/captures/workspace-detail.webp",
  },
  {
    id: "users",
    route: "/modules/saas/customers/users",
    output: "packages/dms-saas/docs/images/captures/users.webp",
  },
  {
    id: "segments",
    route: "/modules/saas/customers/segments",
    output: "packages/dms-saas/docs/images/captures/segments.webp",
  },
  {
    id: "plans",
    route: "/modules/saas/catalog/plans",
    output: "packages/dms-saas/docs/images/captures/plans.webp",
  },
  {
    id: "plan-edit",
    route: "/modules/saas/catalog/plans/helio-plan-pro/edit",
    output: "packages/dms-saas/docs/images/captures/plan-edit.webp",
  },
  {
    id: "features",
    route: "/modules/saas/catalog/features",
    output: "packages/dms-saas/docs/images/captures/features.webp",
  },
  {
    id: "plan-migrations",
    route: "/modules/saas/catalog/plan-migrations",
    output: "packages/dms-saas/docs/images/captures/plan-migrations.webp",
  },
  {
    id: "invoices",
    route: "/modules/saas/billing/invoices",
    output: "packages/dms-saas/docs/images/captures/invoices.webp",
  },
  {
    id: "credit-notes",
    route: "/modules/saas/billing/credit-notes",
    output: "packages/dms-saas/docs/images/captures/credit-notes.webp",
  },
  {
    id: "billing-rules",
    route: "/modules/saas/configuration/settings",
    output: "packages/dms-saas/docs/images/captures/billing-rules.webp",
  },
  {
    id: "switcher",
    route: "/helio/dashboard",
    steps: [
      { action: "click", selector: 'button[aria-label="Switch workspace"]' },
      { action: "wait", selector: 'text="Create workspace"' },
    ],
    output: "packages/dms-saas/docs/images/captures/switcher.webp",
  },
  {
    id: "tenant-general",
    route: "/settings/workspace/general",
    output: "packages/dms-saas/docs/images/captures/tenant-general.webp",
  },
  {
    id: "tenant-members",
    route: "/settings/workspace/members",
    output: "packages/dms-saas/docs/images/captures/tenant-members.webp",
  },
  {
    id: "tenant-billing",
    route: "/settings/workspace/billing",
    output: "packages/dms-saas/docs/images/captures/tenant-billing.webp",
  },
  {
    id: "change-plan",
    route: "/settings/workspace/billing?choose-plan=1",
    output: "packages/dms-saas/docs/images/captures/change-plan.webp",
  },
  {
    id: "tenant-data-export",
    route: "/settings/workspace/data-export",
    output: "packages/dms-saas/docs/images/captures/tenant-data-export.webp",
  },
  {
    id: "publish-terms",
    route: "/modules/saas/configuration/settings",
    setup: true,
    steps: [
      { action: "click", selector: 'text="Legal documents"' },
      {
        action: "fill",
        selector: ".ProseMirror >> nth=0",
        value:
          "These terms govern the use of Helio by installers and their teams. Helio SRL keeps your workspace data in the European Union.",
      },
      { action: "click", selector: 'button:has-text("Save")' },
      { action: "wait", selector: 'text="Published"' },
    ],
  },
  {
    id: "login",
    route: "/helio/dashboard",
    steps: [
      { action: "click", selector: 'button[aria-label="Sophie Lambert"]' },
      { action: "click", selector: 'text="Logout"' },
      { action: "wait", selector: 'input[name="email"]' },
    ],
    output: "packages/dms-saas/docs/images/captures/login.webp",
  },
  {
    id: "pricing",
    route: "/pricing",
    output: "packages/dms-saas/docs/images/captures/pricing.webp",
  },
  {
    id: "terms",
    route: "/terms-of-use",
    output: "packages/dms-saas/docs/images/captures/terms.webp",
  },
]);
