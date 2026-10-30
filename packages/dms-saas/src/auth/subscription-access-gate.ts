import { GetModel } from "@antelopejs/interface-database-decorators";
import { RegisterTenantAccessGate } from "@antelopejs/interface-dms/tenant-access";
import type { TenantSubscriptionStatus } from "../db";
import { TenantSubscriptionModel } from "../db";
import { isGuardedPlanChangeBlocked } from "../plan-changes/guarded-state";

const GATE_ID = "dms-saas.subscription-status";
export const PLAN_CHANGE_ACCESS_GATE_ID = "dms-saas.plan-change";
const GATE_ORDER = 100;

const BLOCKING_STATUS_LIST = [
  "pending_payment",
  "suspended",
  "cancelled",
] as const satisfies readonly TenantSubscriptionStatus[];

export type BlockingStatus = (typeof BLOCKING_STATUS_LIST)[number];

export const BLOCKING_STATUSES = new Set<TenantSubscriptionStatus>(
  BLOCKING_STATUS_LIST,
);

/** Whether a subscription status blocks the workspace's access. */
export function isBlockingStatus(
  status: TenantSubscriptionStatus,
): status is BlockingStatus {
  return BLOCKING_STATUSES.has(status);
}

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
  if (
    subscription &&
    (BLOCKING_STATUSES.has(subscription.status) ||
      isGuardedPlanChangeBlocked(subscription))
  ) {
    return { blocked: true, status: subscription.status };
  }
  return { blocked: false, status: subscription?.status };
}

export function registerSubscriptionAccessGate(): void {
  RegisterTenantAccessGate({
    id: GATE_ID,
    order: GATE_ORDER,
    gate: async (_userId, tenantId) => {
      const { status } = await isTenantSubscriptionBlocked(tenantId);
      if (status && BLOCKING_STATUSES.has(status)) {
        return { allowed: false, code: WORKSPACE_ACCESS_BLOCKED_CODE };
      }
      return { allowed: true };
    },
  });
  RegisterTenantAccessGate({
    id: PLAN_CHANGE_ACCESS_GATE_ID,
    order: GATE_ORDER,
    gate: async (_userId, tenantId) => {
      const subscription = await GetModel(
        TenantSubscriptionModel,
        tenantId,
      ).findOne();
      if (subscription && isGuardedPlanChangeBlocked(subscription)) {
        return { allowed: false, code: WORKSPACE_ACCESS_BLOCKED_CODE };
      }
      return { allowed: true };
    },
  });
}
