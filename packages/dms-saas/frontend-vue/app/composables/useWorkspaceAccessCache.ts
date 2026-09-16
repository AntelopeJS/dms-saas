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
