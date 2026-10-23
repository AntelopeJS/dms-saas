import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import cron, { type ScheduledTask } from "node-cron";
import { TenantSubscriptionModel } from "../db";
import { reconcileGuardedFreeChange } from "../plan-changes/guarded-landing";
import { getRowInstance } from "../utils";

/** Reconcile persisted deadlines even when Stripe webhooks are late or lost. */
export async function reconcileGuardedDowngrades(): Promise<void> {
  const rows = await GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
    .table.filter((row) => row.key("guardedPlanChange").ne(null))
    .run();
  for (const row of rows) {
    const subscription = TenantSubscriptionModel.fromDatabase(row);
    if (!subscription?.guardedPlanChange) continue;
    const tenantId = getRowInstance(subscription);
    try {
      await reconcileGuardedFreeChange(tenantId);
    } catch (error) {
      Logging.Error(
        `[dms-saas:guarded-downgrade] reconciliation failed for ${tenantId}`,
        error,
      );
    }
  }
}

/** Deadlines gate access synchronously; this worker reconciles external effects. */
export function scheduleReconcileGuardedDowngrades(): ScheduledTask {
  return cron.schedule("* * * * *", () => {
    void reconcileGuardedDowngrades().catch((error: unknown) => {
      Logging.Error(
        "[dms-saas:guarded-downgrade] reconciliation failed",
        error,
      );
    });
  });
}
