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

  const { loggedIn } = useUserSession();
  if (!loggedIn.value) return;

  // Cached per workspace: the entry is invalidated when the active tenant
  // changes, and cleared by the suspended screen once the workspace
  // unblocks. An active→blocked transition is enforced server-side by the
  // tenant access gate (typed 403s) until the next reload. A transport error
  // fails open: the worst case is a 403 toast instead of the dedicated screen.
  const access = await loadWorkspaceAccess();

  if (access?.blocked) {
    return SUSPENDED_PATH;
  }
});
