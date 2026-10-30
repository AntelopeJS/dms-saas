import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
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
import { startPlanReconciliation } from "../plans/stripe-sync";
import { ensureLegalDocumentsSingleton } from "../routes";
import { resumePendingPlanMigrations } from "../workers";
import { ensureDefaultSubscription } from "../workspaces/default-plan";
import { exportSaasTenantData } from "./tenant-export";
import { ensureBillingSettingsRow } from "../operator-billing/billing-settings-store";
import { rejectionReasons } from "../utils/rejection-reasons";

function throwDatabaseInitializationFailures(
  results: PromiseSettledResult<unknown>[],
): void {
  const failures = rejectionReasons(results);
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

/**
 * Registers the module's DMS hook listeners and its tenant export contributor.
 *
 * - The export contributor is registered with an explicit module id: it
 *   namespaces the archive entries, and the auto-detected one depends on which
 *   call site the runtime credits.
 * - The DMS creates its default tenant outside the signup flow: it gets the
 *   default plan at its creation, as a workspace registered here does. A
 *   catalogue published later reaches it through `withDefaultPlanChange`.
 * - The plan table is readable only once DMS has registered its schemas, which
 *   `DATABASE_INITIALIZED` signals; module `start()` runs too early. The Stripe
 *   plan reconciliation listener is registered ahead of the other
 *   `DATABASE_INITIALIZED` listener so a failure there does not skip the pass,
 *   and is not awaited so DMS startup never waits on Stripe.
 */
export function registerSaasHookListeners(): void {
  RegisterTenantDataExportContributor(SAAS_MODULE_ID, exportSaasTenantData);
  RegisterHook(
    Hook.TENANT_DELETED,
    async (tenantId: string, context?: TenantDeletionContext) => {
      await GetModel(TenantBillingStateModel).deleteForTenant(tenantId);
      await emitDeletedTenant(tenantId, context);
      return undefined;
    },
  );
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async ({ tenantId }) => {
    if (tenantId === DEFAULT_TENANT_ID) {
      await ensureDefaultSubscription(tenantId);
    }
    return undefined;
  });
  RegisterHook(Hook.DATABASE_INITIALIZED, () => {
    startPlanReconciliation();
    return undefined;
  });
  RegisterHook(Hook.DATABASE_INITIALIZED, async () => {
    await Promise.all([
      ensureLegalDocumentsSingleton(),
      ensureBillingSettingsRow(),
    ]);
    const results = await Promise.allSettled([
      resumePendingPlanMigrations(),
      recomputeAllTenantBillingStates(),
      reconcileWorkspaceLifecycleDeliveries(),
    ]);
    throwDatabaseInitializationFailures(results);
    return undefined;
  });
}
