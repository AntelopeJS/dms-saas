import { randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  ProvisioningAttempt,
  provisioningAttemptsTableName,
} from "./provisioning-attempt.table";

const UNRESOLVED_PAGE_SIZE = 100;

/** Persists recovery evidence without replaying opaque provisioning hooks. */
export class ProvisioningAttemptModel extends BasicDataModel(
  ProvisioningAttempt,
  provisioningAttemptsTableName,
) {
  /** Mutate the observed attempt only; acknowledgement uncertainty must be reconciled, not retried blindly. */
  async advance(
    current: ProvisioningAttempt,
    patch: Partial<ProvisioningAttempt>,
  ): Promise<void> {
    const outcome = await this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: { ...patch, updatedAt: new Date() },
      })
      .run();
    if (outcome !== "applied")
      throw new Error(
        `Provisioning outcome ${outcome}; reconciliation required`,
      );
  }

  /** List the first page of unresolved reservations for authenticated operator reconciliation. */
  async findUnresolved(): Promise<ProvisioningAttempt[]> {
    const rows = await this.table
      .getAll(
        ["preparing", "awaiting_payment", "reconciliation_required"],
        "state",
      )
      .slice(0, UNRESOLVED_PAGE_SIZE)
      .run();
    return rows
      .map((row) => ProvisioningAttemptModel.fromDatabase(row))
      .filter((row): row is ProvisioningAttempt => !!row);
  }
}
