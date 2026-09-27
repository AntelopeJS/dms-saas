import { Logging } from "@antelopejs/interface-core/logging";
import cron, { type ScheduledTask } from "node-cron";
import { recomputeAllTenantBillingStates } from "../billing-state";
import { backfillDefaultSubscriptions } from "../workspaces/default-plan";

const CRON_NAME = "recompute-billing-state";
const CRON_SCHEDULE = "*/15 * * * *";

export function scheduleRecomputeBillingState(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    // Also covers workspaces created outside dms-saas (no creation hook
    // reaches it) and a catalogue whose free plan is published after boot.
    void backfillDefaultSubscriptions()
      .then(recomputeAllTenantBillingStates)
      .catch((error: unknown) => {
        Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
      });
  });
}
