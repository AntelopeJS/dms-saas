import { Logging } from "@antelopejs/interface-core/logging";
import cron, { type ScheduledTask } from "node-cron";
import { reconcileWorkspaceLifecycleDeliveries } from "../operator-actions/lifecycle-outbox";

const CRON_NAME = "reconcile-workspace-lifecycle";
const CRON_SCHEDULE = "*/5 * * * *";

/** Retry durable lifecycle deliveries, including post-payment creation intents. */
export function scheduleReconcileWorkspaceLifecycle(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void reconcileWorkspaceLifecycleDeliveries().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
