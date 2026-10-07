import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type {
  PlanMigration,
  PlanMigrationTenantOutcome,
  TenantSubscription,
} from "../db";
import { PlanMigrationModel, TenantSubscriptionModel } from "../db";
import {
  applyPermissionCleanup,
  migrationOperationId,
  migrationProgress,
  settledMigrationStatus,
  settledOutcomes,
  withTenantOutcome,
} from "./plan-migration";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const UNCERTAIN_STATUSES = new Set<PlanMigrationTenantOutcome["status"]>([
  "reconciliation_required",
  "running",
]);
const FIRST_ATTEMPT = 1;

/** How an operator settles a workspace whose move left Stripe uncertain. */
export type UncertainResolution = "moved" | "not_moved";

/** An operator settling a workspace of a migration, and who they are. */
export interface WorkspaceResolution {
  migrationId: string;
  tenantId: string;
  resolution: UncertainResolution;
  operatorId: string;
}

/** An operator closing a migration with workspaces left behind. */
export interface MigrationReconciliation {
  migrationId: string;
  operatorId: string;
  note: string;
}

async function loadSettledJob(migrationId: string): Promise<PlanMigration> {
  const job = await GetModel(PlanMigrationModel).get(migrationId);
  assert(job, HTTP_NOT_FOUND, "saas.errors.migration.not_found");
  assert(
    job.status !== "pending" && job.status !== "running",
    HTTP_CONFLICT,
    "saas.errors.migration.still_running",
  );
  return job;
}

/**
 * An outcome still `running` once nothing runs was cut short by the
 * executor's end: as uncertain as a reported one.
 */
function isUncertain(outcome: PlanMigrationTenantOutcome): boolean {
  return UNCERTAIN_STATUSES.has(outcome.status);
}

function uncertainOutcome(
  job: PlanMigration,
  tenantId: string,
): PlanMigrationTenantOutcome {
  const outcome = job.tenantOutcomes.find((row) => row.tenantId === tenantId);
  assert(
    outcome && isUncertain(outcome),
    HTTP_CONFLICT,
    "saas.errors.migration.workspace_not_uncertain",
  );
  return outcome;
}

async function loadSubscription(tenantId: string): Promise<TenantSubscription> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  assert(
    subscription,
    HTTP_NOT_FOUND,
    "saas.errors.migration.subscription_missing",
  );
  return subscription;
}

/** The operation id the workspace's last attempt ran under. */
function attemptOperationId(
  job: PlanMigration,
  outcome: PlanMigrationTenantOutcome,
): string {
  return migrationOperationId(
    job._id,
    outcome.tenantId,
    outcome.attempt ?? FIRST_ATTEMPT,
  );
}

/**
 * Stripe shows the target plan: the DMS follows. The workspace takes the
 * frozen target plan and its permissions, and its pending intent is cleared.
 */
async function markMoved(
  job: PlanMigration,
  outcome: PlanMigrationTenantOutcome,
  subscription: TenantSubscription,
): Promise<void> {
  const target = job.snapshot?.target;
  assert(target, HTTP_BAD_REQUEST, "saas.errors.migration.snapshot_missing");
  const model = GetModel(TenantSubscriptionModel, outcome.tenantId);
  const operationId = attemptOperationId(job, outcome);
  const isPending = subscription.domainTransition?.operationId === operationId;
  if (isPending) {
    await model.completeTransition(subscription._id, operationId, {
      planId: target.planId,
      updatedAt: new Date(),
    });
  } else {
    assert(
      subscription.planId === target.planId,
      HTTP_CONFLICT,
      "saas.errors.migration.workspace_changed",
    );
  }
  await applyPermissionCleanup(outcome.tenantId, target.permissions);
}

/**
 * Stripe still shows the source plan: nothing moved. The pending intent is
 * released, so a retry can run under a new operation.
 */
async function markNotMoved(
  job: PlanMigration,
  outcome: PlanMigrationTenantOutcome,
  subscription: TenantSubscription,
): Promise<void> {
  assert(
    subscription.planId === job.fromPlanId,
    HTTP_CONFLICT,
    "saas.errors.migration.workspace_changed",
  );
  const operationId = attemptOperationId(job, outcome);
  if (subscription.domainTransition?.operationId !== operationId) return;
  await GetModel(TenantSubscriptionModel, outcome.tenantId).completeTransition(
    subscription._id,
    operationId,
    {},
  );
}

const RESOLUTION_EFFECTS: Record<UncertainResolution, typeof markMoved> = {
  moved: markMoved,
  not_moved: markNotMoved,
};

const RESOLVED_STATUS: Record<
  UncertainResolution,
  PlanMigrationTenantOutcome["status"]
> = {
  moved: "succeeded",
  not_moved: "failed",
};

async function persistSettled(
  job: PlanMigration,
  outcomes: PlanMigrationTenantOutcome[],
  patch: Partial<PlanMigration> = {},
): Promise<void> {
  const isApplied = await GetModel(PlanMigrationModel).updateSettled(job, {
    ...migrationProgress(outcomes),
    status: settledMigrationStatus(outcomes),
    ...patch,
  });
  assert(isApplied, HTTP_CONFLICT, "saas.errors.migration.changed");
}

/**
 * Settles one workspace an interrupted or ambiguous move left uncertain, as
 * the operator read it in Stripe: moved (the DMS takes the target plan) or
 * not moved (its intent is released and it can be retried).
 *
 * @param input Migration, workspace, what Stripe shows, and the operator
 */
export async function resolveUncertainWorkspace(
  input: WorkspaceResolution,
): Promise<void> {
  const job = await loadSettledJob(input.migrationId);
  const outcome = uncertainOutcome(job, input.tenantId);
  await runTenantLifecycleOperation(input.tenantId, async () => {
    const subscription = await loadSubscription(input.tenantId);
    await RESOLUTION_EFFECTS[input.resolution](job, outcome, subscription);
  });
  await persistSettled(
    job,
    withTenantOutcome(settledOutcomes(job), {
      ...outcome,
      status: RESOLVED_STATUS[input.resolution],
      resolvedBy: input.operatorId,
    }),
  );
}

/**
 * Closes a migration whose remaining workspaces stay on the source plan,
 * with a note for the audit log. Refused while a workspace is uncertain.
 *
 * @param input Migration, the operator and their note
 */
export async function reconcileMigration(
  input: MigrationReconciliation,
): Promise<void> {
  const job = await loadSettledJob(input.migrationId);
  const settled = settledOutcomes(job);
  assert(
    !settled.some(isUncertain),
    HTTP_CONFLICT,
    "saas.errors.migration.uncertain_workspaces",
  );
  const outcomes = settled.map((row) =>
    row.status === "failed" ? { ...row, status: "kept" as const } : row,
  );
  await persistSettled(job, outcomes, {
    reconciledAt: new Date(),
    reconciledBy: input.operatorId,
    reconciliationNote: input.note,
  });
}
