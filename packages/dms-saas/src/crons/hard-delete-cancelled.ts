import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { closeTenantLifecycleAdmission } from "@antelopejs/interface-dms/tenant-lifecycle";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import cron, { type ScheduledTask } from "node-cron";
import {
  type TenantSubscription,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "../utils";
import { MS_PER_DAY } from "../utils/time";
import {
  getWorkspaceDeletionOperationId,
  resolveDataRetentionDays,
} from "../workspaces";

const CRON_NAME = "hard-delete-cancelled";
const CRON_SCHEDULE = "30 4 * * *";

async function deleteAdmittedTenant(
  sub: TenantSubscription,
  cutoff: Date,
): Promise<void> {
  const tenantId = getRowInstance(sub);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const admitted = await model.beginCancelledDeletion(sub._id, cutoff);
  if (!admitted?.deletionStartedAt) return;
  await closeTenantLifecycleAdmission(tenantId);
  const operationId = getWorkspaceDeletionOperationId(tenantId, admitted);
  await ExecuteHooks(Hook.TENANT_DELETED, tenantId, { operationId });
  await GetModel(TenantModel).delete(tenantId);
  await GetModel(TenantBillingInfoModel, tenantId).deleteAll();
  // The admitted marker survives every partial failure; hook effects must accept replay.
  await model.finishDeletion(admitted);
}

async function run(): Promise<void> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );

  const retentionDays = await resolveDataRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);

  const cancelledSubs =
    await tenantSubscriptionModel.findCancelledUpdatedBefore(cutoff);

  for (const sub of cancelledSubs) {
    const tenantId = getRowInstance(sub);
    try {
      await deleteAdmittedTenant(sub, cutoff);
    } catch (error) {
      // Isolate failures: one stuck tenant must not abort the others, and the
      // surviving subscription marker lets the next run resume this tenant.
      Logging.Error(
        `[dms-saas:cron:${CRON_NAME}] failed to delete tenant ${tenantId}`,
        error,
      );
    }
  }
}

export function scheduleHardDeleteCancelled(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void run().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
