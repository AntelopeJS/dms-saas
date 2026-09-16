import { Logging } from "@antelopejs/interface-core/logging";
import cron, { type ScheduledTask } from "node-cron";
import { recomputeAllTenantBillingStates } from "../billing-state";

const CRON_NAME = "recompute-billing-state";
const CRON_SCHEDULE = "*/15 * * * *";

export function scheduleRecomputeBillingState(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void recomputeAllTenantBillingStates().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
