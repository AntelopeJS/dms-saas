import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { recomputeTenantBillingState } from "../billing-state";
import {
  type TenantSubscription,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../db";
import {
  notifyTenantOwners,
  workspaceReactivatedSubject,
  workspaceSuspendedSubject,
} from "../notifications";
import { dispatchWorkspaceLifecycle } from "../operator-actions/lifecycle-outbox";
import { getStripeClient } from "../stripe/client";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

const ACTIVE_STATUS: TenantSubscriptionStatus = "active";
const SUSPENDED_STATUS: TenantSubscriptionStatus = "suspended";
const CANCELLED_STATUS: TenantSubscriptionStatus = "cancelled";

const PAUSE_BEHAVIOR = "void" as const;
const SUSPEND_ICON = "i-ph-prohibit";
const REACTIVATE_ICON = "i-ph-play";

const NOTIF_SUSPEND_TITLE =
  "$saas.notifications.payload.workspace_suspended_admin.title";
const NOTIF_SUSPEND_DESC =
  "$saas.notifications.payload.workspace_suspended_admin.description";
const NOTIF_REACTIVATE_TITLE =
  "$saas.notifications.payload.workspace_reactivated.title";
const NOTIF_REACTIVATE_DESC =
  "$saas.notifications.payload.workspace_reactivated.description";

export interface WorkspaceSuspensionEffectInput {
  tenantId: string;
  operationId: string;
  requestedAt: Date;
  attemptCount: number;
}

export interface WorkspaceSuspensionEffectResult {
  status: TenantSubscriptionStatus;
  effectiveAt: Date;
}

async function pauseStripeCollection(
  stripeSubscriptionId: string,
  operationId: string,
): Promise<void> {
  await getStripeClient().subscriptions.update(
    stripeSubscriptionId,
    { pause_collection: { behavior: PAUSE_BEHAVIOR } },
    { idempotencyKey: `operator-suspend:${operationId}` },
  );
}

async function resumeStripeCollection(
  stripeSubscriptionId: string,
  operationId: string,
): Promise<void> {
  await getStripeClient().subscriptions.update(
    stripeSubscriptionId,
    { pause_collection: null },
    { idempotencyKey: `operator-unsuspend:${operationId}` },
  );
}

async function ensureTenantSubscription(
  tenantId: string,
): Promise<TenantSubscription> {
  const sub = await GetModel(TenantSubscriptionModel, tenantId).findOne();
  assert(sub, HTTP_NOT_FOUND, "saas.errors.workspace.no_active_subscription");
  return sub;
}

function assertCanSuspend(
  input: WorkspaceSuspensionEffectInput,
  sub: TenantSubscription,
): void {
  if (sub.status === SUSPENDED_STATUS) {
    assert(
      input.attemptCount > 1,
      HTTP_CONFLICT,
      "saas.errors.workspace.already_suspended",
    );
    return;
  }
  assert(
    sub.status !== CANCELLED_STATUS,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.is_cancelled",
  );
}

async function closeWorkspaceAccess(
  input: WorkspaceSuspensionEffectInput,
  sub: TenantSubscription,
): Promise<void> {
  if (sub.status === SUSPENDED_STATUS) {
    await recomputeTenantBillingState(input.tenantId);
    return;
  }
  await GetModel(
    TenantSubscriptionModel,
    input.tenantId,
  ).updateDuringTransition(sub._id, input.operationId, {
    status: SUSPENDED_STATUS,
    updatedAt: new Date(),
  });
  await recomputeTenantBillingState(input.tenantId);
}

async function notifySuspended(
  tenantId: string,
  operationId: string,
): Promise<void> {
  await notifyTenantOwners(tenantId, workspaceSuspendedSubject, {
    eventId: `operator-suspended:${operationId}`,
    icon: SUSPEND_ICON,
    title: NOTIF_SUSPEND_TITLE,
    description: NOTIF_SUSPEND_DESC,
  });
}

async function notifyReactivated(
  tenantId: string,
  operationId: string,
): Promise<void> {
  await notifyTenantOwners(tenantId, workspaceReactivatedSubject, {
    eventId: `operator-reactivated:${operationId}`,
    icon: REACTIVATE_ICON,
    title: NOTIF_REACTIVATE_TITLE,
    description: NOTIF_REACTIVATE_DESC,
  });
}

export async function applyWorkspaceSuspension(
  input: WorkspaceSuspensionEffectInput,
): Promise<WorkspaceSuspensionEffectResult> {
  const sub = await ensureTenantSubscription(input.tenantId);
  assertCanSuspend(input, sub);
  await GetModel(TenantSubscriptionModel, input.tenantId).beginTransition(sub, {
    operationId: input.operationId,
    kind: "suspend",
    targetPlanId: null,
    requestedAt: input.requestedAt,
  });
  await closeWorkspaceAccess(input, sub);
  if (sub.stripeSubscriptionId) {
    await pauseStripeCollection(sub.stripeSubscriptionId, input.operationId);
  }
  await dispatchWorkspaceLifecycle({
    tenantId: input.tenantId,
    operationId: input.operationId,
    transition: "suspended",
    requestedAt: input.requestedAt,
  });
  await notifySuspended(input.tenantId, input.operationId);
  return { status: SUSPENDED_STATUS, effectiveAt: new Date() };
}

async function openWorkspaceAccess(
  tenantId: string,
  sub: TenantSubscription,
  mustUpdateSubscription: boolean,
  operationId: string,
): Promise<void> {
  if (mustUpdateSubscription) {
    await GetModel(TenantSubscriptionModel, tenantId).updateDuringTransition(
      sub._id,
      operationId,
      {
        status: ACTIVE_STATUS,
        updatedAt: new Date(),
      },
    );
  }
  await recomputeTenantBillingState(tenantId);
}

export async function applyWorkspaceReactivation(
  input: WorkspaceSuspensionEffectInput,
): Promise<WorkspaceSuspensionEffectResult> {
  const sub = await ensureTenantSubscription(input.tenantId);
  const alreadyApplied = sub.status === ACTIVE_STATUS && input.attemptCount > 1;
  assert(
    sub.status === SUSPENDED_STATUS || alreadyApplied,
    HTTP_CONFLICT,
    "saas.errors.workspace.not_suspended",
  );
  await GetModel(TenantSubscriptionModel, input.tenantId).beginTransition(sub, {
    operationId: input.operationId,
    kind: "reactivate",
    targetPlanId: null,
    requestedAt: input.requestedAt,
  });
  await dispatchWorkspaceLifecycle({
    tenantId: input.tenantId,
    operationId: input.operationId,
    transition: "reactivation_requested",
    requestedAt: input.requestedAt,
  });
  if (sub.stripeSubscriptionId) {
    await resumeStripeCollection(sub.stripeSubscriptionId, input.operationId);
  }
  await openWorkspaceAccess(
    input.tenantId,
    sub,
    !alreadyApplied,
    input.operationId,
  );
  await notifyReactivated(input.tenantId, input.operationId);
  return { status: ACTIVE_STATUS, effectiveAt: new Date() };
}
