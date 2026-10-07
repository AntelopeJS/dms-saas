import type {
  PlanMigration,
  PlanMigrationTenantOutcome,
  PlanMigrationTenantStatus,
} from "../db";

/** Outcomes an operator must settle by reading Stripe. */
const UNCERTAIN_STATUSES = new Set<PlanMigrationTenantStatus>([
  "reconciliation_required",
  "running",
]);
const EXECUTING_STATUSES = new Set(["pending", "running"]);

/** One captured workspace, as the migration detail lists it. */
export interface MigrationWorkspaceView {
  tenantId: string;
  name: string;
  status: PlanMigrationTenantStatus | "pending";
  error: string | null;
  attempt: number;
  updatedAt: Date | null;
  isUncertain: boolean;
}

/** The counts heading a migration detail. */
export interface MigrationTotals {
  captured: number;
  moved: number;
  notMoved: number;
  uncertain: number;
  failed: number;
  notified: number;
}

/** What an operator may do on a migration now. */
export interface MigrationAbilities {
  canRetry: boolean;
  canReconcile: boolean;
  canResolve: boolean;
}

const NOT_MOVED = new Set<PlanMigrationTenantStatus>([
  "reconciliation_required",
  "failed",
  "kept",
]);

/**
 * The outcomes of a migration, a workspace a stopped executor never reached
 * counted as failed (it was never admitted, so it did not move).
 */
function effectiveOutcomes(
  migration: PlanMigration,
): PlanMigrationTenantOutcome[] {
  const outcomes = migration.tenantOutcomes ?? [];
  if (EXECUTING_STATUSES.has(migration.status)) return outcomes;
  const reached = new Set(outcomes.map((row) => row.tenantId));
  const unreached = (migration.snapshot?.tenantIds ?? [])
    .filter((tenantId) => !reached.has(tenantId))
    .map((tenantId) => ({
      tenantId,
      status: "failed" as const,
      error: null,
      seatQuantity: null,
    }));
  return [...outcomes, ...unreached];
}

function countOf(
  outcomes: PlanMigrationTenantOutcome[],
  test: (outcome: PlanMigrationTenantOutcome) => boolean,
): number {
  return outcomes.filter(test).length;
}

/**
 * The counts of a migration: captured, moved, not moved (uncertain, failed
 * or kept), and owners told (moved workspaces when notifying).
 *
 * @param migration The migration
 */
export function migrationTotals(migration: PlanMigration): MigrationTotals {
  const outcomes = effectiveOutcomes(migration);
  const moved = countOf(outcomes, (row) => row.status === "succeeded");
  const isSettled = !EXECUTING_STATUSES.has(migration.status);
  return {
    captured:
      migration.snapshot?.tenantIds.length ?? migration.totalWorkspaces ?? 0,
    moved,
    notMoved: countOf(outcomes, (row) => NOT_MOVED.has(row.status)),
    uncertain: isSettled
      ? countOf(outcomes, (row) => UNCERTAIN_STATUSES.has(row.status))
      : 0,
    failed: countOf(outcomes, (row) => row.status === "failed"),
    notified: migration.notifyMembers ? moved : 0,
  };
}

/**
 * Which operator actions a migration allows: none while it runs; settling
 * an uncertain workspace while one is; a retry once some workspace failed;
 * marking it reconciled once nothing is uncertain and something is left.
 *
 * @param migration The migration
 * @param totals Its counts
 */
export function migrationAbilities(
  migration: PlanMigration,
  totals: MigrationTotals,
): MigrationAbilities {
  const isSettled = !EXECUTING_STATUSES.has(migration.status);
  const isOpen =
    migration.status === "reconciliation_required" ||
    migration.status === "failed";
  return {
    canResolve: isSettled && totals.uncertain > 0,
    canRetry: isSettled && totals.uncertain === 0 && totals.failed > 0,
    canReconcile: isSettled && isOpen && totals.uncertain === 0,
  };
}

/**
 * Every captured workspace with its outcome, the ones needing an operator
 * first. A workspace the executor has not reached yet reads `pending`.
 *
 * @param migration The migration
 * @param names Workspace names by id
 */
export function migrationWorkspaces(
  migration: PlanMigration,
  names: Map<string, string>,
): MigrationWorkspaceView[] {
  const outcomes = new Map(
    effectiveOutcomes(migration).map((row) => [row.tenantId, row]),
  );
  const isSettled = !EXECUTING_STATUSES.has(migration.status);
  const tenantIds = migration.snapshot?.tenantIds ?? [...outcomes.keys()];
  const rows = tenantIds.map((tenantId) => {
    const outcome = outcomes.get(tenantId);
    const status: MigrationWorkspaceView["status"] =
      outcome?.status ?? "pending";
    return {
      tenantId,
      name: names.get(tenantId) ?? tenantId,
      status,
      error: outcome?.error ?? null,
      attempt: outcome?.attempt ?? 0,
      updatedAt: outcome?.updatedAt ?? null,
      isUncertain:
        isSettled &&
        UNCERTAIN_STATUSES.has(status as PlanMigrationTenantStatus),
    };
  });
  return rows.sort(
    (left, right) =>
      Number(right.isUncertain) - Number(left.isUncertain) ||
      Number(right.status === "failed") - Number(left.status === "failed"),
  );
}
