import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  type BillingState,
  TenantBillingStateModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { loadWorkspaceDirectoryFields } from "./directory";

import { registerPastDueBanners } from "./past-due-banner";
import { registerTrialEndingBanners } from "./trial-ending-banner";

export * from "./directory";
export * from "./past-due-banner";
export * from "./recovery";
export * from "./trial-ending-banner";

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

/**
 * Publishes the tenant's billing state and its workspace directory row (plan,
 * seats, MRR, renewal, owner), derived from the records as they are now.
 */
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
    const billingState = deriveBillingState(subscription);
    const directory = await loadWorkspaceDirectoryFields(
      tenantId,
      billingState,
      subscription,
      existing,
    );
    if (
      await model.upsertForTenant(tenantId, billingState, existing, directory)
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

/** The billing strips of the dashboard layout: past due, trial ending. */
export function registerBillingLayoutBanners(): void {
  registerPastDueBanners();
  registerTrialEndingBanners();
}
