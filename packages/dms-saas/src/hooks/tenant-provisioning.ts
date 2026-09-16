import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import type { TenantBeingProvisionedPayload } from "@antelopejs/interface-dms-saas/provisioning";

export type { TenantBeingProvisionedPayload } from "@antelopejs/interface-dms-saas/provisioning";

/**
 * Hand the workspace to whoever else has data to write for it.
 *
 * `ExecuteHooks` runs listeners in series, awaits each one and lets a rejection
 * through — which is the whole point here: called from inside the provisioning
 * transaction, a listener that throws takes the workspace down with it rather
 * than leaving a paid workspace without the data its owner filled in.
 *
 * @param payload Workspace being provisioned and the consumer's own capture
 */
export async function emitTenantBeingProvisioned(
  payload: TenantBeingProvisionedPayload,
): Promise<void> {
  await ExecuteHooks(Hook.TENANT_BEING_PROVISIONED, {
    tenantId: payload.tenantId,
    userId: payload.userId,
    extras: payload.extras ?? {},
  });
}
