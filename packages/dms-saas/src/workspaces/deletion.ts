import { randomUUID } from "node:crypto";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { recomputeTenantBillingState } from "../billing-state";
import type { TenantSubscription, TenantSubscriptionStatus } from "../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_DATA_RETENTION_DAYS,
  TenantSubscriptionModel,
} from "../db";
import {
  notifyTenantOwners,
  subscriptionCancelledSubject,
} from "../notifications";
import { getStripeClient } from "../stripe";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

const CANCELLED_STATUS: TenantSubscriptionStatus = "cancelled";

const NOTIF_ICON = "i-ph-trash";
const NOTIF_TITLE =
  "$saas.notifications.payload.workspace_deletion_requested.title";
const NOTIF_DESC =
  "$saas.notifications.payload.workspace_deletion_requested.description";

export interface WorkspaceDeletionResult {
  status: TenantSubscriptionStatus;
  retentionDays: number;
}

/** Share the durable deletion identity across rollback and retention replays. */
export function getWorkspaceDeletionOperationId(
  tenantId: string,
  subscription: Pick<TenantSubscription, "_id" | "deletionStartedAt">,
): string {
  if (!subscription.deletionStartedAt)
    throw new Error("Subscription deletion has not been admitted");
  return JSON.stringify([
    "retention-delete",
    tenantId,
    subscription._id,
    subscription.deletionStartedAt.toISOString(),
  ]);
}

export async function resolveDataRetentionDays(): Promise<number> {
  const settings = await GetModel(BillingSettingsModel).get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return (
    settings?.dataRetentionDaysAfterCancellation ?? DEFAULT_DATA_RETENTION_DAYS
  );
}

/** Admit cancellation before Stripe; ambiguity retains intent and blocks retention. */
export async function requestWorkspaceDeletion(
  tenantId: string,
): Promise<WorkspaceDeletionResult> {
  const subscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await subscriptionModel.findOne();
  assert(
    subscription,
    HTTP_NOT_FOUND,
    "saas.errors.workspace.no_active_subscription",
  );
  assert(
    subscription.status !== CANCELLED_STATUS,
    HTTP_CONFLICT,
    "saas.errors.workspace.is_cancelled",
  );
  const operationId = randomUUID();
  await subscriptionModel.beginTransition(subscription, {
    operationId,
    kind: "cancel",
    targetPlanId: null,
    requestedAt: new Date(),
  });
  if (subscription.stripeSubscriptionId) {
    await getStripeClient().subscriptions.cancel(
      subscription.stripeSubscriptionId,
      { idempotencyKey: `workspace-delete:${operationId}` },
    );
  }
  await subscriptionModel.completeTransition(subscription._id, operationId, {
    status: CANCELLED_STATUS,
    updatedAt: new Date(),
  });
  return {
    status: CANCELLED_STATUS,
    retentionDays: await runAfterCancellation(tenantId),
  };
}

/**
 * Everything here runs after the cancelled marker is written, so the deletion
 * is already committed: a failure must not answer an error the caller would
 * retry into `is_cancelled`, leaving the UI stranded on a deleted workspace.
 * The billing state is re-derived every 15 minutes by its own cron, and the
 * retention figure only feeds the confirmation message.
 */
async function runAfterCancellation(tenantId: string): Promise<number> {
  await bestEffort(tenantId, "recompute billing state", () =>
    recomputeTenantBillingState(tenantId),
  );
  await bestEffort(tenantId, "notify owners", () =>
    notifyTenantOwners(tenantId, subscriptionCancelledSubject, {
      icon: NOTIF_ICON,
      title: NOTIF_TITLE,
      description: NOTIF_DESC,
    }),
  );
  return resolveDataRetentionDays().catch(() => DEFAULT_DATA_RETENTION_DAYS);
}

async function bestEffort(
  tenantId: string,
  step: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    Logging.Error(
      `[dms-saas:workspace-deletion] ${step} failed for tenant ${tenantId}`,
      error,
    );
  }
}
