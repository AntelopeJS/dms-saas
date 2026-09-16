import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { recomputeTenantBillingState } from "../billing-state";
import {
  type SubscriptionCronNotification,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import {
  freeWorkspaceExpiredSubject,
  notifyTenantOwners,
  workspaceSuspendedSubject,
} from "../notifications";
import { getRowInstance } from "../utils/row-instance";

const NOTIFICATIONS = {
  free_expired: {
    status: "past_due",
    subject: freeWorkspaceExpiredSubject,
    payload: {
      icon: "i-ph-hourglass",
      title: "Complimentary access expired",
      description:
        "The free access granted to your workspace has expired. Pick a paid plan to restore access.",
    },
  },
  suspended: {
    status: "suspended",
    subject: workspaceSuspendedSubject,
    payload: {
      icon: "i-ph-prohibit",
      title: "Workspace suspended",
      description:
        "Your workspace was suspended after a prolonged unpaid invoice. Settle the balance to restore access.",
    },
  },
};

async function deliver(subscription: TenantSubscription): Promise<void> {
  const tenantId = getRowInstance(subscription);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  await recomputeTenantBillingState(tenantId);
  const current = await model.get(subscription._id);
  if (!current?.cronNotification || current.domainTransition) return;
  const notification = NOTIFICATIONS[current.cronNotification.kind];
  if (!current.deletionStartedAt && current.status === notification.status) {
    await notifyTenantOwners(tenantId, notification.subject, {
      ...notification.payload,
      eventId: JSON.stringify([tenantId, current.cronNotification.eventId]),
    });
  }
  await model.completeCronNotification(current);
}

/** Replays durable intents independently of the status-transition candidate scan. */
export async function deliverSubscriptionCronNotifications(
  kind: SubscriptionCronNotification["kind"],
): Promise<void> {
  const pending = await GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  ).findCronNotifications(kind);
  for (const subscription of pending) {
    await deliver(subscription).catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${kind}] notification failed`, error);
    });
  }
}
