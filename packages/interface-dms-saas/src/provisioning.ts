import type { JsonObject } from "./json";

/**
 * Workspace and consumer-owned capture supplied to provisioning listeners.
 */
export interface TenantBeingProvisionedPayload {
  tenantId: string;
  /**
   * Account the workspace is provisioned for. Absent for the DMS `default`
   * tenant, which is created at startup before anyone signs up.
   */
  userId?: string;
  /** Consumer-owned capture forwarded verbatim and normalized to an object. */
  extras?: JsonObject;
}
