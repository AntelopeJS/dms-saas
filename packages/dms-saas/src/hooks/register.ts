import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  Hook,
  type TenantDeletionContext,
  RegisterHook,
  RegisterTenantDataExportContributor,
} from "@antelopejs/interface-dms/hooks";
import { emitAutomationEvent, emitTenantDeletedEvent } from "../automation";
import { recomputeAllTenantBillingStates } from "../billing-state";
import { TenantBillingStateModel } from "../db";
import { reconcileWorkspaceLifecycleDeliveries } from "../operator-actions";
import { SAAS_MODULE_ID } from "../pages/module";
import { ensureLegalDocumentsSingleton } from "../routes";
import { resumePendingPlanMigrations } from "../workers";
import { backfillDefaultSubscriptions } from "../workspaces/default-plan";
import { exportSaasTenantData } from "./tenant-export";

function throwDatabaseInitializationFailures(
  results: PromiseSettledResult<unknown>[],
): void {
  const failures = results.flatMap<unknown>((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "Database initialization failed");
}

async function emitDeletedTenant(
  tenantId: string,
  context?: TenantDeletionContext,
): Promise<void> {
  if (!context) {
    emitAutomationEvent("saas.tenant-deleted", {
      tenantId,
      at: new Date().toISOString(),
    });
    return;
  }
  const tombstone = await GetModel(TenantBillingStateModel).findByTenant(
    tenantId,
  );
  if (!tombstone?.deletedAt)
    throw new Error("Tenant deletion tombstone is missing");
  await emitTenantDeletedEvent({
    tenantId,
    at: tombstone.deletedAt.toISOString(),
    operationId: context.operationId,
  });
}

export function registerSaasHookListeners(): void {
  // Registered with an explicit module id: it namespaces the archive entries,
  // and the auto-detected one depends on which call site the runtime credits.
  RegisterTenantDataExportContributor(SAAS_MODULE_ID, exportSaasTenantData);
  RegisterHook(
    Hook.TENANT_DELETED,
    async (tenantId: string, context?: TenantDeletionContext) => {
      await GetModel(TenantBillingStateModel).deleteForTenant(tenantId);
      await emitDeletedTenant(tenantId, context);
      return undefined;
    },
  );
  RegisterHook(Hook.DATABASE_INITIALIZED, async () => {
    await ensureLegalDocumentsSingleton();
    const results = await Promise.allSettled([
      resumePendingPlanMigrations(),
      // The backfill publishes the billing state of every workspace it
      // covers, so it runs before the full recompute rather than beside it.
      backfillDefaultSubscriptions().then(recomputeAllTenantBillingStates),
      reconcileWorkspaceLifecycleDeliveries(),
    ]);
    throwDatabaseInitializationFailures(results);
    return undefined;
  });
}
