import { randomUUID } from "node:crypto";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import { closeTenantLifecycleAdmission } from "@antelopejs/interface-dms/tenant-lifecycle";
import {
  TenantBillingInfoModel,
  TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../db";
import { cancelWorkspaceCreated } from "../operator-actions/lifecycle-outbox";
import { getStripeClient } from "../stripe";
import { getWorkspaceDeletionOperationId } from "./deletion";
import type { WorkspaceProvisioningHandles } from "./provisioning";
import { recordProvisioningState } from "./provisioning-state";

/** Preserve recovery evidence and account ownership unless every cancellation and closure succeeds. */
export async function rollbackWorkspaceProvisioning(
  handles: WorkspaceProvisioningHandles,
): Promise<void> {
  if (handles.mustPreserveWorkspace) return;
  handles.mustPreserveWorkspace = true;
  try {
    if (handles.tenantId) await closeTenantLifecycleAdmission(handles.tenantId);
    const finishCancellation = await admitRollbackCancellation(
      handles.tenantId,
    );
    if (handles.tenantId) await cancelWorkspaceCreated(handles.tenantId);
    const stripe = getStripeClient();
    if (handles.stripeSubscriptionId)
      await stripe.subscriptions.cancel(handles.stripeSubscriptionId);
    if (handles.stripeCustomerId)
      await stripe.customers.del(handles.stripeCustomerId);
    const deletionOperationId = await finishCancellation();
    if (handles.tenantId)
      await deleteTenantRecords(handles.tenantId, deletionOperationId);
    if (handles.trialConsumptionId)
      await GetModel(TrialConsumptionModel).delete(handles.trialConsumptionId);
    if (handles.tenantId) await recordProvisioningState(handles, "cancelled");
    handles.mustPreserveWorkspace = false;
  } catch (error) {
    Logging.Error(
      `[dms-saas:provisioning-rollback] ${handles.tenantId} requires reconciliation`,
      error,
    );
  }
}

async function admitRollbackCancellation(
  tenantId?: string,
): Promise<() => Promise<string | undefined>> {
  if (!tenantId) return async () => undefined;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await model.findOne();
  if (!subscription) return async () => undefined;
  const operationId = randomUUID();
  await model.beginTransition(subscription, {
    operationId,
    kind: "cancel",
    targetPlanId: null,
    requestedAt: new Date(),
  });
  return async () => {
    const deletionStartedAt = new Date();
    await model.completeTransition(subscription._id, operationId, {
      deletionStartedAt,
    });
    return getWorkspaceDeletionOperationId(tenantId, {
      _id: subscription._id,
      deletionStartedAt,
    });
  };
}

async function deleteTenantRecords(
  tenantId: string,
  deletionOperationId?: string,
): Promise<void> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  await ExecuteHooks(Hook.TENANT_DELETED, tenantId, {
    operationId: deletionOperationId ?? `provisioning-cancel:${tenantId}`,
  });
  const tenantBillingInfoModel = GetModel(TenantBillingInfoModel, tenantId);
  await GetModel(TenantModel).delete(tenantId);
  await tenantBillingInfoModel.deleteAll();
  await tenantSubscriptionModel.deleteAll();
}
