import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  InvoiceLineInjection,
  type InvoiceLineInjectionState,
  invoiceLineInjectionsTableName,
} from "./task.table";

const ACTIVE_STATES: InvoiceLineInjectionState[] = [
  "registered",
  "suspended",
  "finalizing",
];

/** A lease held on a task: the revision it was taken at is the fence. */
export interface InvoiceLineInjectionLease {
  task: InvoiceLineInjection;
  leaseId: string;
}

export type NewInvoiceLineInjection = Pick<
  InvoiceLineInjection,
  | "_id"
  | "tenantId"
  | "customerId"
  | "stripeSubscriptionId"
  | "currency"
  | "periodStart"
  | "periodEnd"
  | "source"
  | "eventId"
  | "providerIds"
>;

export function isInvoiceLineInjectionLeasable(
  task: InvoiceLineInjection,
  now: number,
): boolean {
  if (!ACTIVE_STATES.includes(task.state)) return false;
  return !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= now;
}

/**
 * Tasks are only ever changed by compare-and-set on `revision`. Whoever holds
 * the lease writes with the revision its last write produced, so a handler
 * or worker whose lease expired and was taken over can no longer write — and
 * it renews (one more CAS) right before every Stripe call, so it stops there.
 */
export class InvoiceLineInjectionModel extends BasicDataModel(
  InvoiceLineInjection,
  invoiceLineInjectionsTableName,
) {
  /** Insert once per invoice; a concurrent or later registration reads the row back. */
  async register(row: NewInvoiceLineInjection): Promise<InvoiceLineInjection> {
    const now = new Date();
    try {
      await this.insert({
        ...row,
        state: "registered",
        reason: null,
        suspendedAt: null,
        fingerprint: null,
        revision: randomUUID(),
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        attemptCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      const existing = await this.get(row._id);
      if (!existing) throw error;
      return existing;
    }
    const inserted = await this.get(row._id);
    if (!inserted) throw new Error("Invoice line injection task vanished");
    return inserted;
  }

  async listActive(): Promise<InvoiceLineInjection[]> {
    const rows = await this.table.getAll(ACTIVE_STATES, "state").run();
    return rows
      .map((row) => InvoiceLineInjectionModel.fromDatabase(row))
      .filter((row): row is InvoiceLineInjection => !!row);
  }

  /** Take the task for `leaseMs`, or null when a live holder or a racer has it. */
  async acquire(
    task: InvoiceLineInjection,
    leaseMs: number,
  ): Promise<InvoiceLineInjectionLease | null> {
    const now = Date.now();
    if (!isInvoiceLineInjectionLeasable(task, now)) return null;
    const leaseId = randomUUID();
    const leased = await this.write(task, {
      leaseId,
      leaseExpiresAt: new Date(now + leaseMs),
    });
    return leased ? { task: leased, leaseId } : null;
  }

  /** Extend the lease; false means it was lost and nothing more may be done. */
  async renew(
    lease: InvoiceLineInjectionLease,
    leaseMs: number,
  ): Promise<boolean> {
    const renewed = await this.write(lease.task, {
      leaseExpiresAt: new Date(Date.now() + leaseMs),
    });
    if (!renewed) return false;
    lease.task = renewed;
    return true;
  }

  /** Record a transition under the lease; false means the lease was lost. */
  async advance(
    lease: InvoiceLineInjectionLease,
    patch: Partial<InvoiceLineInjection>,
  ): Promise<boolean> {
    const advanced = await this.write(lease.task, patch);
    if (!advanced) return false;
    lease.task = advanced;
    return true;
  }

  async release(lease: InvoiceLineInjectionLease): Promise<void> {
    await this.write(lease.task, { leaseId: null, leaseExpiresAt: null });
  }

  private async write(
    current: InvoiceLineInjection,
    patch: Partial<InvoiceLineInjection>,
  ): Promise<InvoiceLineInjection | null> {
    const nextRevision = randomUUID();
    const updatedAt = new Date();
    const outcome: AtomicMutationOutcome = await this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision,
        patch: { ...patch, updatedAt },
      })
      .run();
    if (outcome === "unknown")
      throw new Error(
        `Invoice line injection ${current._id}: write outcome unknown`,
      );
    if (outcome !== "applied") return null;
    return Object.assign(current, patch, {
      revision: nextRevision,
      updatedAt,
    });
  }
}
