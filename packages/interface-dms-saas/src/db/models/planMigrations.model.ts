import { randomUUID } from "node:crypto";
import {
  BasicDataModel,
  type DeepPartial,
  type ValidateOptions,
} from "@antelopejs/interface-database-decorators";
import {
  PlanMigration,
  type PlanMigrationSnapshot,
  planMigrationsTableName,
} from "../tables/planMigrations.table";

/** Immutable migration snapshots and revision-fenced progress, without takeover. */
export class PlanMigrationModel extends BasicDataModel(
  PlanMigration,
  planMigrationsTableName,
) {
  /** Initialize revisions for new jobs; retained legacy records need an offline upgrade. */
  override insert(
    rows: DeepPartial<PlanMigration> | DeepPartial<PlanMigration>[],
    options?: ValidateOptions,
  ): Promise<string[]> {
    const initialize = (
      row: DeepPartial<PlanMigration>,
    ): DeepPartial<PlanMigration> => ({
      ...row,
      revision: randomUUID(),
      tenantOutcomes: [],
    });
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

  private async persist(
    job: PlanMigration,
    patch: Partial<PlanMigration>,
  ): Promise<boolean> {
    const nextRevision = randomUUID();
    const outcome = await this.table
      .atomicMutation(job._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision:
          job.revision === undefined ? { kind: "missing" } : job.revision,
        nextRevision,
        patch,
      })
      .run();
    if (outcome === "unknown")
      throw new Error(
        "Migration acknowledgement unknown; reconciliation required",
      );
    if (outcome !== "applied") return false;
    Object.assign(job, patch, { revision: nextRevision });
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

  /** Advisory UI check; subscription admission remains the concurrency boundary. */
  async existsPendingOrRunningForPlan(fromPlanId: string): Promise<boolean> {
    const count = await this.table
      .getAll(fromPlanId, "fromPlanId")
      .filter((row) =>
        row
          .key("status")
          .eq("pending")
          .or(row.key("status").eq("running"))
          .or(row.key("status").eq("reconciliation_required")),
      )
      .count()
      .run();
    return count > 0;
  }
}
