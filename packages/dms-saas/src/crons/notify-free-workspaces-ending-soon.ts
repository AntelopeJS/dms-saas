import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
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
  await notifyTenantOwners(tenantId, freeWorkspaceEndingSoonSubject, {
    eventId: JSON.stringify([
      CRON_NAME,
      tenantId,
      current._id,
      current.freeUntil.toISOString(),
    ]),
    icon: ENDING_SOON_ICON,
    title: "Complimentary access ending soon",
    description: `Your free access expires on ${formatDate(current.freeUntil)}. Pick a paid plan before then to keep access.`,
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
