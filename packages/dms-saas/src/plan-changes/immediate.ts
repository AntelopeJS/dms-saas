import { randomUUID } from "node:crypto";
import { recomputeTenantBillingState } from "../billing-state";
import type {
  Plan,
  SubscriptionTransition,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { syncStripeSeatQuantity } from "../plans";
import { applyPlanDowngradeCleanup } from "../workers";

/** A fresh intent to move a workspace to `newPlan` now. */
export function newChangeIntent(newPlan: Plan): SubscriptionTransition {
  return {
    operationId: randomUUID(),
    kind: "change_plan",
    targetPlanId: newPlan._id,
    requestedAt: new Date(),
  };
}

/** Points the workspace at the plan Stripe now bills, under the admitted intent. */
export async function recordPlanChange(
  subscription: TenantSubscription,
  newPlan: Plan,
  operationId: string,
  tenantSubscriptionModel: TenantSubscriptionModel,
): Promise<void> {
  await tenantSubscriptionModel.updateDuringTransition(
    subscription._id,
    operationId,
    {
      planId: newPlan._id,
      updatedAt: new Date(),
    },
  );
}

/** Complete retryable work that follows an immediate plan write. */
export async function finalizeImmediateChange(
  tenantId: string,
  subscription: TenantSubscription,
  newPlan: Plan,
): Promise<void> {
  await applyPlanDowngradeCleanup(tenantId, newPlan);
  await syncStripeSeatQuantity({
    tenantId,
    plan: newPlan,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    idempotencyKey: `seat-sync:change-plan:${tenantId}:${subscription._id}:${newPlan._id}`,
  });
  await recomputeTenantBillingState(tenantId);
}
