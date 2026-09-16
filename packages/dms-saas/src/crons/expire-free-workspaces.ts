import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import { TenantSubscriptionModel } from "../db";
import { getRowInstance } from "../utils";
import { deliverSubscriptionCronNotifications } from "./subscription-notifications";

const CRON_NAME = "expire-free-workspaces";
const CRON_SCHEDULE = "0 2 * * *";

async function run(): Promise<void> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );

  const now = new Date();
  const expired = await tenantSubscriptionModel.findExpiredFreeBefore(now);
  for (const sub of expired) {
    await GetModel(TenantSubscriptionModel, getRowInstance(sub))
      .expireFree(sub._id, now)
      .catch((error: unknown) => {
        Logging.Error(`[dms-saas:cron:${CRON_NAME}] transition failed`, error);
      });
  }
  await deliverSubscriptionCronNotifications("free_expired");
}

export function scheduleExpireFreeWorkspaces(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void run().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
