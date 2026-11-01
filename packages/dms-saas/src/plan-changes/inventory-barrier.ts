import { setTimeout as delay } from "node:timers/promises";
import {
  observeTenantLifecycle,
  pauseTenantLifecycleAdmission,
  resumeTenantLifecycleAdmission,
} from "@antelopejs/interface-dms/tenant-lifecycle";
import type {
  GuardedPlanChange,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../db";

const DRAIN_WAIT_MS = 2000;
const DRAIN_POLL_MS = 50;

/**
 * This coordinator must not itself be admitted as an inventory writer. Each
 * poll observes the tenant lifecycle before it validates the change's intent:
 * an abort invalidates the observed revision through resume, even if
 * acquisition has not happened yet.
 */
export async function drainPlanInventory(
  tenantId: string,
  model: TenantSubscriptionModel,
  change: GuardedPlanChange,
): Promise<TenantSubscription> {
  const deadline = Date.now() + DRAIN_WAIT_MS;
  while (Date.now() <= deadline) {
    const inventory = await observeTenantLifecycle(tenantId);
    const current = await model.findOne();
    if (
      !current ||
      current.guardedPlanChange?.barrierId !== change.barrierId ||
      current.guardedPlanChange.phase !== change.phase
    ) {
      throw new Error("Inventory preparation is no longer current");
    }
    if (inventory.closed)
      throw new Error("Tenant deletion has closed inventory admission");
    if (inventory.barrierId === change.barrierId) {
      if (inventory.activeAttemptIds.length === 0) return current;
    } else if (inventory.barrierId) {
      throw new Error("Another inventory preparation is active");
    } else {
      await pauseTenantLifecycleAdmission(
        tenantId,
        change.barrierId,
        inventory.revision,
      );
    }
    await delay(DRAIN_POLL_MS);
  }
  throw new Error(
    "Inventory writers have not drained; retry after they finish",
  );
}

/** Release only this phase, without erasing pre-admitted or uncertain writers. */
export async function releasePlanInventory(
  tenantId: string,
  change: GuardedPlanChange,
): Promise<void> {
  await resumeTenantLifecycleAdmission(tenantId, change.barrierId);
}
