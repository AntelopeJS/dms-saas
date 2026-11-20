import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import { AutomationClaimModel } from "../automation/db/automation-claim.model";
import { emitAutomationEvent } from "../automation/events";
import { type TenantSubscription, TenantSubscriptionModel } from "../db";
import {
  freeWorkspaceEndingSoonSubject,
  notifyTenantOwners,
} from "../notifications";
import { getRowInstance } from "../utils";
import { MS_PER_DAY } from "../utils/time";

const CRON_NAME = "notify-free-workspaces-ending-soon";
const CRON_SCHEDULE = "0 3 * * *";
const ENDING_SOON_ICON = "i-ph-hourglass";
const WARNING_LEAD_DAYS = 3;
const WINDOW_WIDTH_DAYS = 1;
const ACTIVE_STATUS = "active";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The daily run sees one end date on up to four runs: the claim lets the
 * trigger fire on the first only.
 */
async function emitFreeAccessEnding(
  tenantId: string,
  subscription: TenantSubscription,
  freeUntil: Date,
  deliveryId: string,
): Promise<void> {
  if (!(await GetModel(AutomationClaimModel).claim(tenantId, deliveryId)))
    return;
  const now = Date.now();
  emitAutomationEvent("saas.free-access-ending", {
    tenantId,
    deliveryId,
    at: new Date(now).toISOString(),
    freeUntil: freeUntil.toISOString(),
    planId: subscription.planId,
    daysLeft: Math.floor((freeUntil.getTime() - now) / MS_PER_DAY),
  });
}

async function notifyCurrentSubscription(
  sub: TenantSubscription,
): Promise<void> {
  const tenantId = getRowInstance(sub);
  const current = await GetModel(TenantSubscriptionModel, tenantId).findOne();
  if (
    !current?.freeUntil ||
    current._id !== sub._id ||
    current.status !== ACTIVE_STATUS ||
    current.deletionStartedAt ||
    current.domainTransition ||
    current.stripeSubscriptionId ||
    current.freeUntil.getTime() !== sub.freeUntil?.getTime() ||
    current.freeUntil.getTime() <= Date.now()
  )
    return;
  const eventId = JSON.stringify([
    CRON_NAME,
    tenantId,
    current._id,
    current.freeUntil.toISOString(),
  ]);
  await emitFreeAccessEnding(tenantId, current, current.freeUntil, eventId);
  await notifyTenantOwners(tenantId, freeWorkspaceEndingSoonSubject, {
    eventId,
    icon: ENDING_SOON_ICON,
    title: "$saas.notifications.payload.complimentary_access_ending_soon.title",
    description:
      "$saas.notifications.payload.complimentary_access_ending_soon.description",
    params: { date: formatDate(current.freeUntil) },
  });
}

async function run(): Promise<void> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );

  const now = Date.now();
  const start = new Date(now);
  const end = new Date(
    now + (WARNING_LEAD_DAYS + WINDOW_WIDTH_DAYS) * MS_PER_DAY,
  );

  const ending = await tenantSubscriptionModel.findFreeEndingBetween(
    start,
    end,
  );
  if (ending.length === 0) return;

  for (const sub of ending) {
    await notifyCurrentSubscription(sub).catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] delivery failed`, error);
    });
  }
}

export function scheduleNotifyFreeWorkspacesEndingSoon(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void run().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
