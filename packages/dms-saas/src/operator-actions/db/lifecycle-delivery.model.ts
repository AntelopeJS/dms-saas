import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { WorkspaceLifecycleReceipt } from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import {
  LifecycleDelivery,
  lifecycleDeliveriesTableName,
  type WorkspaceProvisioningState,
} from "./lifecycle-delivery.table";

const REPLAYABLE_STATUSES = ["pending", "failed", "running"];
const CLAIMABLE_STATUSES = new Set(["pending", "failed"]);
// Longer than any consumer call is expected to take, so a live attempt is
// never retaken, and short enough that the reconcile cron recovers a crashed
// attempt within a couple of runs.
const CLAIM_LEASE_MS = 10 * 60 * 1000;

/** True when no live attempt holds the delivery: unclaimed, or its lease expired. */
export function isLifecycleDeliveryClaimable(
  delivery: LifecycleDelivery,
  now: number = Date.now(),
): boolean {
  if (CLAIMABLE_STATUSES.has(delivery.status)) return true;
  if (delivery.status !== "running") return false;
  return !delivery.claimExpiresAt || delivery.claimExpiresAt.getTime() <= now;
}

/** Durable receipts for idempotent consumers; each attempt holds a leased claim. */
export class LifecycleDeliveryModel extends BasicDataModel(
  LifecycleDelivery,
  lifecycleDeliveriesTableName,
) {
  /** Advance the creation decision without reopening cancelled workspaces. */
  async transitionProvisioning(
    id: string,
    expected: WorkspaceProvisioningState,
    next: WorkspaceProvisioningState,
    invoiceId?: string | null,
  ): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new Error("Workspace provisioning state is missing");
    if (
      current.provisioningState === next &&
      (invoiceId === undefined || invoiceId === current.provisioningInvoiceId)
    )
      return;
    if (current.provisioningState !== expected)
      throw new Error("Workspace provisioning state changed");
    const patch: Partial<LifecycleDelivery> = { provisioningState: next };
    if (invoiceId !== undefined) patch.provisioningInvoiceId = invoiceId;
    if (next === "cancelled") patch.status = "succeeded";
    const outcome = await this.mutate(current, patch);
    if (outcome !== "applied")
      throw new Error(
        `Workspace provisioning ${outcome}; reconcile before retry`,
      );
  }

  async findByOperation(operationId: string): Promise<LifecycleDelivery[]> {
    return this.getBy("operationId", operationId);
  }

  /** Deliveries no live attempt holds; a claim can still be lost to a concurrent reconciler. */
  async findReplayable(): Promise<LifecycleDelivery[]> {
    const rows = await this.table.getAll(REPLAYABLE_STATUSES, "status").run();
    const now = Date.now();
    return rows
      .map((row) => LifecycleDeliveryModel.fromDatabase(row))
      .filter(
        (row): row is LifecycleDelivery =>
          !!row && isLifecycleDeliveryClaimable(row, now),
      );
  }

  /**
   * Take the delivery for one attempt, fenced on the observed revision so
   * concurrent or replayed reconcilers never invoke the consumer twice.
   * Returns the delivery updated in place, or null when another attempt holds or won it.
   */
  async claim(delivery: LifecycleDelivery): Promise<LifecycleDelivery | null> {
    const now = Date.now();
    if (!isLifecycleDeliveryClaimable(delivery, now)) return null;
    const patch: Partial<LifecycleDelivery> = {
      status: "running",
      claimId: randomUUID(),
      claimExpiresAt: new Date(now + CLAIM_LEASE_MS),
      startedAt: new Date(now),
    };
    const outcome = await this.mutate(delivery, patch);
    if (outcome === "unknown")
      throw new Error("Workspace lifecycle claim unknown; retry after lease");
    if (outcome !== "applied") return null;
    return Object.assign(delivery, patch);
  }

  /** A competing receipt is terminal; a failed or late writer cannot overwrite it. */
  async markSucceeded(
    delivery: LifecycleDelivery,
    receipt: WorkspaceLifecycleReceipt,
  ): Promise<void> {
    const current = await this.get(delivery._id);
    if (!current) throw new Error("Workspace lifecycle delivery is missing");
    if (current.status === "succeeded") return;
    const now = new Date();
    const outcome = await this.mutate(current, {
      status: "succeeded",
      receiptId: receipt.receiptId,
      acceptedAt: now,
      effectiveAt: receipt.effectiveAt ?? now,
      completedAt: now,
      attemptCount: current.attemptCount + 1,
    });
    if (outcome === "applied") return;
    if (outcome === "unknown")
      throw new Error(
        "Workspace lifecycle receipt unknown; reconcile before retry",
      );
    const latest = await this.get(delivery._id);
    if (latest?.status !== "succeeded")
      throw new Error("Workspace lifecycle receipt changed; retry delivery");
  }

  /** Failure accounting never overwrites a concurrent success, provisioning decision or newer claim. */
  async markFailed(delivery: LifecycleDelivery): Promise<void> {
    const current = await this.get(delivery._id);
    if (!current || current.status === "succeeded") return;
    if (current.claimId !== delivery.claimId) return;
    const outcome = await this.mutate(current, {
      status: "failed",
      claimExpiresAt: null,
      lastErrorCode: "saas.errors.lifecycle.consumer_failed",
      completedAt: new Date(),
      attemptCount: current.attemptCount + 1,
    });
    if (outcome === "unknown")
      throw new Error("Workspace lifecycle failure outcome unknown");
  }

  private mutate(
    current: LifecycleDelivery,
    patch: Partial<LifecycleDelivery>,
  ): Promise<AtomicMutationOutcome> {
    return this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: { ...patch, updatedAt: new Date() },
      })
      .run();
  }
}
