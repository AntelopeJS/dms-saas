import { randomUUID } from "node:crypto";
import {
  BasicDataModel,
  type DeepPartial,
  type ValidateOptions,
} from "@antelopejs/interface-database-decorators";
import {
  PlanMigration,
  type PlanMigrationSnapshot,
  type PlanMigrationStatus,
  planMigrationStageOf,
  planMigrationsTableName,
} from "../tables/planMigrations.table";

/** Statuses an executor works under: nobody else may write the job then. */
const EXECUTING_STATUSES: ReadonlySet<PlanMigrationStatus> = new Set([
  "pending",
  "running",
]);

/** Immutable migration snapshots and revision-fenced progress, without takeover. */
export class PlanMigrationModel extends BasicDataModel(
  PlanMigration,
  planMigrationsTableName,
) {
  /** Every job starts with a revision, which each progress checkpoint requires. */
  override insert(
    rows: DeepPartial<PlanMigration> | DeepPartial<PlanMigration>[],
    options?: ValidateOptions,
  ): Promise<string[]> {
    const initialize = (
      row: DeepPartial<PlanMigration>,
    ): DeepPartial<PlanMigration> => {
      const initialized: DeepPartial<PlanMigration> = {
        ...row,
        revision: randomUUID(),
        tenantOutcomes: [],
      };
      if (row.status) initialized.stage = planMigrationStageOf(row.status);
      return initialized;
    };
    return super.insert(
      Array.isArray(rows) ? rows.map(initialize) : initialize(rows),
      options,
    );
  }

  /** Freeze membership and target configuration before admitting a single execution. */
  async beginJob(
    job: PlanMigration,
    snapshot: PlanMigrationSnapshot,
  ): Promise<boolean> {
    if (job.status !== "pending") return false;
    return this.persist(job, {
      snapshot,
      totalWorkspaces: snapshot.tenantIds.length,
      status: "running",
      startedAt: new Date(),
    });
  }

  /** Persist progress only while this observed execution remains current. */
  async checkpoint(
    job: PlanMigration,
    patch: Partial<PlanMigration>,
  ): Promise<void> {
    if (job.status !== "running" || !(await this.persist(job, patch)))
      throw new Error("Migration progress changed; reconciliation required");
  }

  /** Flag a running job whose executor is gone; a concurrent change wins and returns false. */
  async markInterrupted(job: PlanMigration): Promise<boolean> {
    if (job.status !== "running") return false;
    return this.persist(job, { status: "reconciliation_required" });
  }

  /**
   * Rewrite a migration no executor works on (an operator resolving a
   * workspace, or closing the migration), under the observed revision; a
   * concurrent change wins and returns false.
   */
  async updateSettled(
    job: PlanMigration,
    patch: Partial<PlanMigration>,
  ): Promise<boolean> {
    if (EXECUTING_STATUSES.has(job.status)) return false;
    return this.persist(job, patch);
  }

  /**
   * Admit one retry of a settled migration: it runs again under the observed
   * revision, so two retries started together execute once.
   */
  async reopen(job: PlanMigration): Promise<boolean> {
    if (EXECUTING_STATUSES.has(job.status)) return false;
    return this.persist(job, { status: "running", completedAt: null });
  }

  /** Migrations stored before stages existed. */
  async findWithoutStage(): Promise<PlanMigration[]> {
    const rows = await this.table
      .filter((row) => row.key("stage").eq(null))
      .run();
    return rows
      .map((row) => PlanMigrationModel.fromDatabase(row))
      .filter((row): row is PlanMigration => row !== undefined);
  }

  /**
   * Writes the stage of a migration stored before stages existed, under the
   * observed revision: a status written meanwhile carries its own stage.
   */
  async backfillStage(job: PlanMigration): Promise<boolean> {
    if (job.stage) return false;
    return this.persist(job, { stage: planMigrationStageOf(job.status) });
  }

  private async persist(
    job: PlanMigration,
    patch: Partial<PlanMigration>,
  ): Promise<boolean> {
    const nextRevision = randomUUID();
    const written: Partial<PlanMigration> = patch.status
      ? { ...patch, stage: planMigrationStageOf(patch.status) }
      : patch;
    const outcome = await this.table
      .atomicMutation(job._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: job.revision,
        nextRevision,
        patch: written,
      })
      .run();
    if (outcome === "unknown")
      throw new Error(
        "Migration acknowledgement unknown; reconciliation required",
      );
    if (outcome !== "applied") return false;
    Object.assign(job, written, { revision: nextRevision });
    return true;
  }

  /** Running jobs are inspectable interruptions, never automatically replayable work. */
  async findResumable(): Promise<PlanMigration[]> {
    const rows = await this.table
      .getAll(["pending", "running"], "status")
      .run();
    return rows
      .map((row) => PlanMigrationModel.fromDatabase(row))
      .filter((row): row is PlanMigration => row !== undefined);
  }

  /**
   * Advisory UI check, true while a migration of the plan runs or waits for an
   * operator; subscription admission remains the concurrency boundary.
   */
  async existsPendingOrRunningForPlan(fromPlanId: string): Promise<boolean> {
    const count = await this.table
      .getAll(fromPlanId, "fromPlanId")
      .filter((row) =>
        row
          .key("status")
          .eq("pending")
          .or(row.key("status").eq("running"))
          .or(row.key("status").eq("reconciliation_required"))
          .or(row.key("status").eq("failed")),
      )
      .count()
      .run();
    return count > 0;
  }
}
