import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "../utils";
import { MS_PER_DAY } from "../utils/time";
import { deliverSubscriptionCronNotifications } from "./subscription-notifications";

const CRON_NAME = "auto-suspend-past-due";
const CRON_SCHEDULE = "0 1 * * *";

async function run(): Promise<void> {
  const billingSettingsModel = GetModel(BillingSettingsModel);
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );

  const settings = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  if (!settings || !settings.autoSuspendEnabled) return;

  const delayDays =
    settings.autoSuspendDelayDays ?? DEFAULT_AUTO_SUSPEND_DELAY_DAYS;
  const cutoff = new Date(Date.now() - delayDays * MS_PER_DAY);

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
