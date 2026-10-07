import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { type Tenant, TenantModel } from "@antelopejs/interface-dms/db";

import {
  deriveBillingState,
  loadWorkspaceDirectoryFields,
} from "../billing-state";
import {
  type BillingState,
  type Plan,
  PlanModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  TenantBillingStateModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  type WorkspaceDirectoryFields,
} from "../db";
import { getSeatUsage, type SeatUsage } from "../plans/seat-capacity";

const HTTP_NOT_FOUND = 404;

/** One workspace as the back office reads it, with its directory row fresh. */
export interface WorkspaceOperatorView {
  tenant: Tenant;
  subscription: TenantSubscription | undefined;
  plan: Plan | null;
  billingInfo: TenantBillingInfo | undefined;
  billingState: BillingState;
  directory: WorkspaceDirectoryFields;
  seats: SeatUsage;
}

/** Loads a workspace for an operator screen; 404 when it does not exist. */
export async function loadWorkspaceOperatorView(
  tenantId: string,
): Promise<WorkspaceOperatorView> {
  const tenant = await GetModel(TenantModel).get(tenantId);
  assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
  const [subscription, billingInfo, existing, seats] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantBillingInfoModel, tenantId).findOne(),
    GetModel(TenantBillingStateModel).findByTenant(tenantId),
    getSeatUsage(tenantId),
  ]);
  const billingState = deriveBillingState(subscription);
  const [plan, directory] = await Promise.all([
    subscription?.planId
      ? GetModel(PlanModel).get(subscription.planId)
      : undefined,
    loadWorkspaceDirectoryFields(
      tenantId,
      billingState,
      subscription,
      existing,
    ),
  ]);
  return {
    tenant,
    subscription,
    plan: plan ?? null,
    billingInfo,
    billingState,
    directory,
    seats,
  };
}
