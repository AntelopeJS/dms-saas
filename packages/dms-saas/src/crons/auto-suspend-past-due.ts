import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import { TenantSubscriptionModel } from "../db";
import { getRowInstance } from "../utils";
import { MS_PER_DAY } from "../utils/time";
import { deliverSubscriptionCronNotifications } from "./subscription-notifications";
import { loadBillingSettings } from "../operator-billing/billing-settings-store";

const CRON_NAME = "auto-suspend-past-due";
const CRON_SCHEDULE = "0 1 * * *";

async function run(): Promise<void> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );

  const settings = await loadBillingSettings();
  if (!settings.autoSuspendEnabled) return;

  const cutoff = new Date(
    Date.now() - settings.autoSuspendDelayDays * MS_PER_DAY,
  );

  const toSuspend =
    await tenantSubscriptionModel.findPastDueSinceBefore(cutoff);
  for (const sub of toSuspend) {
    await GetModel(TenantSubscriptionModel, getRowInstance(sub))
      .suspendPastDue(sub._id, cutoff)
      .catch((error: unknown) => {
        Logging.Error(`[dms-saas:cron:${CRON_NAME}] transition failed`, error);
      });
  }
}

export function scheduleAutoSuspendPastDue(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void run()
      .finally(() => deliverSubscriptionCronNotifications("suspended"))
      .catch((error: unknown) => {
        Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
      });
  });
}
