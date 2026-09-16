import { isWorkspaceProvisioningCommitted } from "../../operator-actions/lifecycle-outbox";

export * from "../../operator-actions/lifecycle-consumers";

/** Implements the inventory provisioning gate without exposing lifecycle storage. */
export async function IsWorkspaceProvisioningCommitted(
  tenantId: string,
): Promise<boolean> {
  return isWorkspaceProvisioningCommitted(tenantId);
}
