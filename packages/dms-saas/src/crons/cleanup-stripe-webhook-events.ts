import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import { AutomationClaimModel } from "../automation/db/automation-claim.model";
import { StripeWebhookEventModel } from "../db";
import { MS_PER_DAY } from "../utils/time";

const CRON_NAME = "cleanup-stripe-webhook-events";
const CRON_SCHEDULE = "0 4 * * *";
const RETENTION_DAYS = 90;
const AUTOMATION_CLAIM_RETENTION_DAYS = 30;

async function run(): Promise<void> {
  const stripeWebhookEventModel = GetModel(StripeWebhookEventModel);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * MS_PER_DAY);
  await stripeWebhookEventModel.deleteProcessedBefore(cutoff);
  await GetModel(AutomationClaimModel).deleteClaimedBefore(
    new Date(Date.now() - AUTOMATION_CLAIM_RETENTION_DAYS * MS_PER_DAY),
  );
}

export function scheduleCleanupStripeWebhookEvents(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void run().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
