export interface WorkspaceAccess {
  blocked: boolean;
  status?: string;
  isTenantOwner: boolean;
  /** Owner-only, and only while blocked: what the suspended screen offers to
   * settle. Members and unblocked workspaces get null. */
  unpaidInvoice: UnpaidInvoiceRef | null;
}

export interface CachedWorkspaceAccess {
  tenantId: string;
  access: WorkspaceAccess;
}

/**
 * Per-session cache of the current workspace's subscription access, shared
 * between the global workspace-suspended middleware (reader/writer) and the
 * suspended screen (invalidator once the workspace unblocks).
 */
export function useWorkspaceAccessCache() {
  return useDmsState<CachedWorkspaceAccess | null>(
    "saas-workspace-access",
    () => null,
  );
}

const ACCESS_ENDPOINT = "/api/saas/billing/access";
const FALLBACK_TENANT_ID = "default";

/**
 * The active workspace's access, served from the cache while it still belongs
 * to the active tenant and fetched otherwise.
 *
 * @returns The access, or null on a transport error — callers fail open, the
 *   backend gate still denies every tenant surface
 */
export async function loadWorkspaceAccess(): Promise<WorkspaceAccess | null> {
  const { session } = useUserSession();
  const tenantId =
    (session.value as { activeTenantId?: string } | null)?.activeTenantId ??
    FALLBACK_TENANT_ID;
  const cached = useWorkspaceAccessCache();
  if (cached.value?.tenantId === tenantId) return cached.value.access;
  const { $authFetch } = useAuthFetch();
  try {
    const access = await $authFetch<WorkspaceAccess>(ACCESS_ENDPOINT);
    cached.value = { tenantId, access };
    return access;
  } catch {
    return null;
  }
}
