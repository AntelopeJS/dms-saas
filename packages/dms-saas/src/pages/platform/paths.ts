/**
 * Dashboard paths of the back-office pages that routes link to (attention
 * cards, activity entries, headline figures). They follow the page tree:
 * `/modules/<module>/<category>/<page>`.
 */
export const WORKSPACES_PAGE_PATH = "/modules/saas/customers/workspaces";
const PLANS_PAGE_PATH = "/modules/saas/catalog/plans";
export const PLAN_MIGRATIONS_PAGE_PATH =
  "/modules/saas/catalog/plan-migrations";
export const INVOICES_PAGE_PATH = "/modules/saas/billing/invoices";

/** The detail page of one workspace. */
export function workspaceDetailPath(tenantId: string): string {
  return `${WORKSPACES_PAGE_PATH}/${encodeURIComponent(tenantId)}`;
}

/** The workspace list opened on one of its predefined views. */
export function workspacesViewPath(viewId: string): string {
  return `${WORKSPACES_PAGE_PATH}?view=${encodeURIComponent(viewId)}`;
}

/** The workspace list opened on one of its status tabs. */
export function workspacesTabPath(tabId: string): string {
  return `${WORKSPACES_PAGE_PATH}?tab=${encodeURIComponent(tabId)}`;
}

/** The edit page of one plan. */
export function planEditPath(planId: string): string {
  return `${PLANS_PAGE_PATH}/${encodeURIComponent(planId)}/edit`;
}
