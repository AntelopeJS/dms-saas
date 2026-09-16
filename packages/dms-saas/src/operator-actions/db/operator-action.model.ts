import { randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { OperatorActionDetails } from "../types";
import {
  OperatorAction,
  operatorActionsTableName,
} from "./operator-action.table";

export interface OperatorActionSuccess {
  details: OperatorActionDetails;
  effectiveAt: Date;
}

/** Durable command outcomes; a running attempt is never reassigned by time. */
export class OperatorActionModel extends BasicDataModel(
  OperatorAction,
  operatorActionsTableName,
) {
  /** Admit only work whose previous execution has definitively ended. */
  async beginAttempt(current: OperatorAction): Promise<OperatorAction> {
    if (!["pending", "failed"].includes(current.status))
      throw new Error("Operator action requires reconciliation");
    return this.mutate(current, {
      status: "running",
      attemptCount: current.attemptCount + 1,
      startedAt: new Date(),
      completedAt: null,
      lastErrorCode: null,
    });
  }

  /** A success is durable before the subscription intent can be cleared. */
  async markSucceeded(
    current: OperatorAction,
    outcome: OperatorActionSuccess,
  ): Promise<OperatorAction> {
    return this.mutate(current, {
      status: "succeeded",
      ...outcome,
      completedAt: new Date(),
    });
  }

  /** Only a definite, completed failure permits another automatic attempt. */
  async markFailed(
    current: OperatorAction,
    errorCode: string,
  ): Promise<OperatorAction> {
    return this.mutate(current, {
      status: "failed",
      lastErrorCode: errorCode,
      completedAt: new Date(),
    });
  }

  /** Preserve indeterminate operations until executor quiescence and external state are established. */
  async markReconciliationRequired(
    current: OperatorAction,
    errorCode: string,
  ): Promise<OperatorAction> {
    return this.mutate(current, {
      status: "reconciliation_required",
      lastErrorCode: errorCode,
      completedAt: new Date(),
    });
  }

  /** Checkpoint immutable provider request details before effects. */
  async updateDetails(
    current: OperatorAction,
    details: OperatorActionDetails,
  ): Promise<OperatorAction> {
    return this.mutate(current, { details });
  }

  private async mutate(
    current: OperatorAction,
    patch: Partial<OperatorAction>,
  ): Promise<OperatorAction> {
    const revision = randomUUID();
    const updatedAt = new Date();
    const outcome = await this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision:
          current.revision === undefined
            ? { kind: "missing" }
            : current.revision,
        nextRevision: revision,
        patch: { ...patch, updatedAt },
      })
      .run();
    if (outcome !== "applied")
      throw new Error(`Operator action ${outcome}; reconciliation required`);
    return Object.assign(current, patch, { revision, updatedAt });
  }
}
