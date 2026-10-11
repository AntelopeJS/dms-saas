import type { Tone } from "@antelopejs/interface-dms/base";
import {
  PLAN_MIGRATION_TENANT_STATUSES,
  type PlanMigration,
  type PlanMigrationTenantOutcome,
  type PlanMigrationTenantStatus,
  isPlanMigrationExecuting,
} from "../db";
import {
  isNotMovedOutcome,
  isUncertainOutcome,
  settledOutcomes,
} from "./migration-outcomes";

/** Where a captured workspace stands, `pending` until the run reaches it. */
export type MigrationWorkspaceStatus = PlanMigrationTenantStatus | "pending";

/** Every state a captured workspace can be listed in. */
export const MIGRATION_WORKSPACE_STATUSES: readonly MigrationWorkspaceStatus[] =
  ["pending", ...PLAN_MIGRATION_TENANT_STATUSES];

/** One colour per workspace outcome, in the migration family's spirit. */
export const MIGRATION_WORKSPACE_TONES: Record<MigrationWorkspaceStatus, Tone> =
  {
    pending: "neutral",
    running: "info",
    succeeded: "success",
    reconciliation_required: "error",
    failed: "warning",
    kept: "neutral",
  };

/** One captured workspace, as the migration detail lists it. */
export interface MigrationWorkspaceView {
  tenantId: string;
  name: string;
  status: MigrationWorkspaceStatus;
  error: string | null;
  attempt: number;
  updatedAt: Date | null;
  isUncertain: boolean;
  /** Operator who settled an uncertain outcome by hand. */
  resolvedBy: string | null;
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

/** The outcomes of a migration, the ones a stopped run never reached included. */
function effectiveOutcomes(
  migration: PlanMigration,
): PlanMigrationTenantOutcome[] {
  return isPlanMigrationExecuting(migration.status)
    ? migration.tenantOutcomes
    : settledOutcomes(migration);
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
  const isSettled = !isPlanMigrationExecuting(migration.status);
  return {
    captured: migration.snapshot?.tenantIds.length ?? migration.totalWorkspaces,
    moved,
    notMoved: countOf(outcomes, (row) => isNotMovedOutcome(row)),
    uncertain: isSettled
      ? countOf(outcomes, (row) => isUncertainOutcome(row))
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
  const isSettled = !isPlanMigrationExecuting(migration.status);
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
  const isSettled = !isPlanMigrationExecuting(migration.status);
  const tenantIds = migration.snapshot?.tenantIds ?? [...outcomes.keys()];
  const rows = tenantIds.map((tenantId) => {
    const outcome = outcomes.get(tenantId);
    const status: MigrationWorkspaceStatus = outcome?.status ?? "pending";
    return {
      tenantId,
      name: names.get(tenantId) ?? tenantId,
      status,
      error: outcome?.error ?? null,
      attempt: outcome?.attempt ?? 0,
      updatedAt: outcome?.updatedAt ?? null,
      resolvedBy: outcome?.resolvedBy ?? null,
      isUncertain:
        isSettled && outcome !== undefined && isUncertainOutcome(outcome),
    };
  });
  return rows.sort(
    (left, right) =>
      Number(right.isUncertain) - Number(left.isUncertain) ||
      Number(right.status === "failed") - Number(left.status === "failed"),
  );
}

/** A plan a migration moves from or to, as its detail names and prices it. */
export interface MigrationPlanRef {
  _id: string;
  name: string;
  /** Price in major units, when the plan still exists. */
  price: number | null;
  currency: string | null;
}

/** Everything the blocks of a migration's detail page are built from. */
export interface MigrationDetailContext {
  migration: PlanMigration;
  from: MigrationPlanRef;
  to: MigrationPlanRef;
  totals: MigrationTotals;
  abilities: MigrationAbilities;
  workspaces: MigrationWorkspaceView[];
  /** Names of the operators the migration mentions, by user id. */
  people: Map<string, string>;
}

/** The workspaces an operator must look at: uncertain, then failed. */
export function needsAttention(view: MigrationWorkspaceView): boolean {
  return view.isUncertain || view.status === "failed";
}

/** The first workspace still uncertain, which blocks closing the migration. */
export function firstUncertain(
  context: MigrationDetailContext,
): MigrationWorkspaceView | undefined {
  return context.workspaces.find((view) => view.isUncertain);
}
