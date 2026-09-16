import { GetModel } from "@antelopejs/interface-database-decorators";
import { RegisterTenantAccessGate } from "@antelopejs/interface-dms/tenant-access";
import type { TenantSubscriptionStatus } from "../db";
import { TenantSubscriptionModel } from "../db";

const GATE_ID = "dms-saas.subscription-status";
const GATE_ORDER = 100;

export const BLOCKING_STATUSES = new Set<TenantSubscriptionStatus>([
  "pending_payment",
  "suspended",
  "cancelled",
]);

/**
 * 403 body returned by every tenant authorization surface when the
 * workspace's subscription blocks access. The frontend matches this code to
 * route the user to the suspended-workspace screen.
 */
export const WORKSPACE_ACCESS_BLOCKED_CODE =
  "saas.errors.workspace.access_blocked";

export async function isTenantSubscriptionBlocked(
  tenantId: string,
): Promise<{ blocked: boolean; status?: TenantSubscriptionStatus }> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await tenantSubscriptionModel.findOne();
  if (subscription && BLOCKING_STATUSES.has(subscription.status)) {
    return { blocked: true, status: subscription.status };
  }
  return { blocked: false, status: subscription?.status };
}

export function registerSubscriptionAccessGate(): void {
  RegisterTenantAccessGate({
    id: GATE_ID,
    order: GATE_ORDER,
    gate: async (_userId, tenantId) => {
      const { blocked } = await isTenantSubscriptionBlocked(tenantId);
      if (blocked) {
        return { allowed: false, code: WORKSPACE_ACCESS_BLOCKED_CODE };
      }
      return { allowed: true };
    },
  });
}
