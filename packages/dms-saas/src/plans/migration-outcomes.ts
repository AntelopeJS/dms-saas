import type {
  PlanMigration,
  PlanMigrationTenantOutcome,
  PlanMigrationTenantStatus,
} from "../db";

/** The attempt a workspace's first move runs under. */
export const FIRST_MIGRATION_ATTEMPT = 1;

const NOT_REACHED_ERROR = "Not reached before the migration stopped";

/**
 * Outcomes an operator must settle by reading Stripe. One still `running`
 * once nothing runs was cut short by the executor's end: as uncertain as a
 * reported one.
 */
const UNCERTAIN_OUTCOME_STATUSES: ReadonlySet<PlanMigrationTenantStatus> =
  new Set(["reconciliation_required", "running"]);

/** Outcomes of a workspace left on the source plan. */
const NOT_MOVED_OUTCOME_STATUSES: ReadonlySet<PlanMigrationTenantStatus> =
  new Set(["reconciliation_required", "failed", "kept"]);

/** An outcome as the executor or an operator records it, before it is timed. */
export type RecordedTenantOutcome = Omit<
  PlanMigrationTenantOutcome,
  "updatedAt"
>;

/** Whether a workspace's move is uncertain once nothing runs. */
export function isUncertainOutcome(
  outcome: Pick<PlanMigrationTenantOutcome, "status">,
): boolean {
  return UNCERTAIN_OUTCOME_STATUSES.has(outcome.status);
}

/** Whether a workspace is left on the source plan. */
export function isNotMovedOutcome(
  outcome: Pick<PlanMigrationTenantOutcome, "status">,
): boolean {
  return NOT_MOVED_OUTCOME_STATUSES.has(outcome.status);
}

/**
 * Every captured workspace's outcome once nothing runs: a workspace an
 * interrupted executor never reached was never admitted, so it did not move
 * and can be retried from its first attempt. It took that state when the run
 * ended.
 *
 * @param job A settled migration
 */
export function settledOutcomes(
  job: PlanMigration,
): PlanMigrationTenantOutcome[] {
  const reached = new Set(job.tenantOutcomes.map((row) => row.tenantId));
  const unreached = (job.snapshot?.tenantIds ?? [])
    .filter((tenantId) => !reached.has(tenantId))
    .map((tenantId) => ({
      tenantId,
      status: "failed" as const,
      error: NOT_REACHED_ERROR,
      seatQuantity: null,
      attempt: FIRST_MIGRATION_ATTEMPT - 1,
      updatedAt: job.completedAt,
    }));
  return [...job.tenantOutcomes, ...unreached];
}

/** Workspace outcomes with one workspace's outcome replaced, timed now. */
export function withTenantOutcome(
  outcomes: PlanMigrationTenantOutcome[],
  outcome: RecordedTenantOutcome,
): PlanMigrationTenantOutcome[] {
  return [
    ...outcomes.filter((row) => row.tenantId !== outcome.tenantId),
    { ...outcome, updatedAt: new Date() },
  ];
}
