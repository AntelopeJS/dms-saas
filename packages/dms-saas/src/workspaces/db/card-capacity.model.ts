import { createHash, randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  CardCapacity,
  type CardCapacityAllocation,
  cardCapacitiesTableName,
} from "./card-capacity.table";

const MAX_ADMISSION_ATTEMPTS = 16;
type ReadFreeWorkspaceIds = () => Promise<string[]>;

/** Avoid storing the raw payment fingerprint in the capacity ledger key. */
export function cardCapacityId(fingerprint: string): string {
  return createHash("sha256").update(fingerprint).digest("hex");
}

function currentAllocations(
  capacity: CardCapacity,
  liveIds: string[],
): CardCapacityAllocation[] {
  const live = new Set(liveIds);
  const allocations = capacity.allocations.filter(
    (allocation) =>
      allocation.state !== "confirmed" || live.has(allocation.tenantId),
  );
  const known = new Set(allocations.map((allocation) => allocation.tenantId));
  return [
    ...allocations,
    ...liveIds
      .filter((tenantId) => !known.has(tenantId))
      .map((tenantId): CardCapacityAllocation => ({
        tenantId,
        state: "confirmed",
      })),
  ];
}

/** Free-workspace admission through a durable capacity ledger, never a timed lease. */
export class CardCapacityModel extends BasicDataModel(
  CardCapacity,
  cardCapacitiesTableName,
) {
  private async getOrCreate(id: string): Promise<CardCapacity> {
    const existing = await this.get(id);
    if (existing) return existing;
    try {
      await this.insert({ _id: id, revision: randomUUID(), allocations: [] });
    } catch (error) {
      const concurrent = await this.get(id);
      if (concurrent) return concurrent;
      throw error;
    }
    const created = await this.get(id);
    if (!created) throw new Error("Card capacity was not persisted");
    return created;
  }

  private replaceAllocations(
    current: CardCapacity,
    allocations: CardCapacityAllocation[],
  ): Promise<AtomicMutationOutcome> {
    return this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: { allocations },
      })
      .run();
  }

  /** Read live usage after the ledger revision so a concurrent admission invalidates the snapshot. */
  async reserve(
    id: string,
    tenantId: string,
    limit: number,
    readLiveIds: ReadFreeWorkspaceIds,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ADMISSION_ATTEMPTS; attempt++) {
      const current = await this.getOrCreate(id);
      if (
        current.allocations.some(
          (allocation) => allocation.tenantId === tenantId,
        )
      )
        return true;
      const allocations = currentAllocations(current, await readLiveIds());
      if (allocations.length >= limit) return false;
      allocations.push({ tenantId, state: "reserved" });
      const outcome = await this.replaceAllocations(current, allocations);
      if (outcome === "applied") return true;
      if (outcome === "unknown")
        throw new Error("Card capacity admission requires reconciliation");
    }
    throw new Error(
      "Card capacity changed during admission; retry the request",
    );
  }

  /** Retain the allocation after provisioning; future admission reconciles confirmed live usage. */
  async confirm(id: string, tenantId: string): Promise<void> {
    await this.changeAllocation(id, tenantId, "confirmed");
  }

  /** Release only after the provisioning attempt has durably recorded definitive cancellation. */
  async releaseCancelled(id: string, tenantId: string): Promise<void> {
    await this.changeAllocation(id, tenantId, undefined);
  }

  private async changeAllocation(
    id: string,
    tenantId: string,
    state: CardCapacityAllocation["state"] | undefined,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_ADMISSION_ATTEMPTS; attempt++) {
      const current = await this.get(id);
      if (
        !current ||
        !current.allocations.some(
          (allocation) => allocation.tenantId === tenantId,
        )
      )
        return;
      const allocations = current.allocations.filter(
        (allocation) => allocation.tenantId !== tenantId,
      );
      if (state) allocations.push({ tenantId, state });
      const outcome = await this.replaceAllocations(current, allocations);
      if (outcome === "applied") return;
      if (outcome === "unknown")
        throw new Error("Card capacity outcome requires reconciliation");
    }
    throw new Error("Card capacity changed during reconciliation");
  }
}
