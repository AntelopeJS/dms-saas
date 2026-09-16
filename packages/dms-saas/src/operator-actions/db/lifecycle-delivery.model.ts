import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { WorkspaceLifecycleReceipt } from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import {
  LifecycleDelivery,
  lifecycleDeliveriesTableName,
  type WorkspaceProvisioningState,
} from "./lifecycle-delivery.table";

/** Durable receipts for concurrently replayable, idempotent consumers; no delivery lease. */
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

  async findReplayable(): Promise<LifecycleDelivery[]> {
    const rows = await this.table.getAll(["pending", "failed"], "status").run();
    return rows
      .map((row) => LifecycleDeliveryModel.fromDatabase(row))
      .filter((row): row is LifecycleDelivery => !!row);
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

  /** Failure accounting never overwrites a concurrent success or provisioning decision. */
  async markFailed(delivery: LifecycleDelivery): Promise<void> {
    if (delivery.status === "succeeded") return;
    const outcome = await this.mutate(delivery, {
      status: "failed",
      lastErrorCode: "saas.errors.lifecycle.consumer_failed",
      completedAt: new Date(),
      attemptCount: delivery.attemptCount + 1,
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
        expectedRevision:
          current.revision === undefined
            ? { kind: "missing" }
            : current.revision,
        nextRevision: randomUUID(),
        patch: { ...patch, updatedAt: new Date() },
      })
      .run();
  }
}
