import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  type BillingState,
  TenantBillingStateModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";

export * from "./recovery";

const ACTIVE_STATUS = "active";
const FREE_STATE: BillingState = "free";
const PUBLICATION_ATTEMPTS = 3;

export function deriveBillingState(
  subscription: TenantSubscription | undefined,
): BillingState {
  if (!subscription) return FREE_STATE;
  if (
    subscription.status === ACTIVE_STATUS &&
    !subscription.stripeSubscriptionId
  ) {
    return FREE_STATE;
  }
  return subscription.status;
}

export async function recomputeTenantBillingState(
  tenantId: string,
): Promise<void> {
  const model = GetModel(TenantBillingStateModel);
  for (let attempt = 0; attempt < PUBLICATION_ATTEMPTS; attempt++) {
    const existing = await model.findByTenant(tenantId);
    if (existing?.deletedAt) return;
    const subscription = await GetModel(
      TenantSubscriptionModel,
      tenantId,
    ).findOne();
    if (subscription?.deletionStartedAt) return;
    if (
      await model.upsertForTenant(
        tenantId,
        deriveBillingState(subscription),
        existing,
      )
    )
      return;
  }
  throw new Error(
    "Billing recomputation conflicted with a concurrent publication",
  );
}

export async function recomputeAllTenantBillingStates(): Promise<void> {
  const tenants = await GetModel(TenantModel).table.pluck("_id").run();
  for (const tenant of tenants) {
    if (!tenant._id) continue;
    await recomputeTenantBillingState(tenant._id);
  }
}
