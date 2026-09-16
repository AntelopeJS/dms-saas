/**
 * Workspace and consumer-owned capture supplied to provisioning listeners.
 */
export interface TenantBeingProvisionedPayload {
  tenantId: string;
  userId: string;
  /** Consumer-owned capture forwarded verbatim and normalized to an object. */
  extras?: Record<string, unknown>;
}
