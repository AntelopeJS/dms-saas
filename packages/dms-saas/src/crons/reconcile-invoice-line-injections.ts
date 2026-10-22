import { Logging } from "@antelopejs/interface-core/logging";
import cron, { type ScheduledTask } from "node-cron";
import { reconcileInvoiceLineInjections } from "../invoice-line-items";

const CRON_NAME = "reconcile-invoice-line-injections";
const CRON_SCHEDULE = "*/5 * * * *";

/** Suspend, inject and finalize cycle invoices whose usage lines are pending. */
export function scheduleReconcileInvoiceLineInjections(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void reconcileInvoiceLineInjections().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
