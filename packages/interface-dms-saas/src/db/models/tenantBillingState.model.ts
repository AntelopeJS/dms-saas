import { randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type BillingState,
  TenantBillingState,
  tenantBillingStateTableName,
} from "../tables/tenantBillingState.table";

const DELETE_ATTEMPTS = 3;

/** Data access for tenant billing access state. */
export class TenantBillingStateModel extends BasicDataModel(
  TenantBillingState,
  tenantBillingStateTableName,
) {
  async findByTenant(
    tenantId: string,
  ): Promise<TenantBillingState | undefined> {
    return this.get(tenantId);
  }

  /** Publishes against the snapshot read before deriving the billing state. */
  async upsertForTenant(
    tenantId: string,
    billingState: BillingState,
    existing: TenantBillingState | undefined,
  ): Promise<boolean> {
    if (existing?.deletedAt) return true;
    return this.publish(tenantId, existing, billingState, null);
  }

  private async publish(
    tenantId: string,
    existing: TenantBillingState | undefined,
    billingState: BillingState,
    deletedAt: Date | null,
  ): Promise<boolean> {
    const revision = randomUUID();
    const patch = { tenantId, billingState, updatedAt: new Date(), deletedAt };
    if (!existing)
      return this.insertPublication({ _id: tenantId, ...patch, revision });
    const outcome = await this.table
      .atomicMutation(tenantId, {
        type: "update",
        revisionField: "revision",
        expectedRevision: existing.revision,
        nextRevision: revision,
        patch,
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Billing publication outcome is unknown");
    return outcome === "applied";
  }

  private async insertPublication(row: TenantBillingState): Promise<boolean> {
    try {
      await this.insert(row);
    } catch (error) {
      const current = await this.get(row._id);
      if (!current) throw error;
      return current.revision === row.revision;
    }
    const current = await this.get(row._id);
    if (!current) throw new Error("Billing publication was not persisted");
    return current.revision === row.revision;
  }

  async countByState(billingState: BillingState): Promise<number> {
    return this.table
      .getAll(billingState, "billingState")
      .filter((row) =>
        row
          .key("deletedAt")
          .eq(null)
          .and(row.key("_id").eq(row.key("tenantId"))),
      )
      .count()
      .run();
  }

  /** A durable tombstone fences even a recomputation that initially read no row. */
  async deleteForTenant(tenantId: string): Promise<void> {
    for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt++) {
      const existing = await this.get(tenantId);
      if (existing?.deletedAt) return;
      if (await this.publish(tenantId, existing, "cancelled", new Date()))
        return;
    }
    throw new Error(
      "Billing deletion conflicted with a concurrent publication",
    );
  }
}
