const ACCESS_ENDPOINT = "/api/saas/billing/access";
const SUSPENDED_PATH = "/workspace-suspended";
// The billing page carries `bypassTenantAccessGate`, so the gate lets it
// through: redirecting it here would close the recovery path the flag opens.
const BILLING_PATH = "/settings/workspace/billing";

// Paths a blocked workspace member must still reach: auth flows, the
// suspended screen itself, billing, registration and legal pages.
const EXEMPT_PREFIXES = [
  "/auth",
  SUSPENDED_PATH,
  BILLING_PATH,
  "/register",
  "/legal",
  "/terms-of-use",
  "/terms-and-conditions",
  "/privacy-policy",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export default defineDmsMiddleware(async (to) => {
  if (import.meta.env.SSR) return;
  if (isExempt(to.path)) return;

  const { loggedIn, session } = useUserSession();
  if (!loggedIn.value) return;

  const tenantId =
    (session.value as { activeTenantId?: string } | null)?.activeTenantId ??
    "default";

  // Cached per workspace: the entry is invalidated when the active tenant
  // changes, and cleared by the suspended screen once the workspace
  // unblocks. An active→blocked transition is enforced server-side by the
  // tenant access gate (typed 403s) until the next reload.
  const cached = useWorkspaceAccessCache();

  if (cached.value === null || cached.value.tenantId !== tenantId) {
    const { $authFetch } = useAuthFetch();
    try {
      const access = await $authFetch<WorkspaceAccess>(ACCESS_ENDPOINT);
      cached.value = { tenantId, access };
    } catch {
      // Fail open on transport errors: the backend gate still denies every
      // tenant surface, so the worst case is a 403 toast instead of the
      // dedicated screen.
      return;
    }
  }

  if (cached.value?.access.blocked) {
    return SUSPENDED_PATH;
  }
});
