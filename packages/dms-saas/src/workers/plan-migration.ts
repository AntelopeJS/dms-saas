import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type {
  Plan,
  PlanMigration,
  PlanMigrationSnapshot,
  PlanMigrationStatus,
  PlanMigrationTarget,
  PlanMigrationTenantOutcome,
  TenantSubscription,
} from "../db";
import { PlanMigrationModel, PlanModel, TenantSubscriptionModel } from "../db";
import { notifyTenantOwners, planMigratedSubject } from "../notifications";
import { countOccupiedSeats, syncStripeSeatQuantity } from "../plans";
import {
  FIRST_MIGRATION_ATTEMPT,
  type RecordedTenantOutcome,
  isNotMovedOutcome,
  settledOutcomes,
  withTenantOutcome,
} from "../plans/migration-outcomes";
import { publishMigrationChange } from "../plans/migration-realtime";
import { redirectPendingPlanChange } from "../plan-changes/pending-target";
import { getStripeClient } from "../stripe/client";
import { isDefinitiveStripeRejection } from "../stripe/workspace-checkout";
import { getRowInstance } from "../utils";

const ALL_PERMISSIONS = "*";
const ICON_MIGRATION = "i-ph-stack";
const PRORATION_BEHAVIOR = "create_prorations" as const;
const UNKNOWN_FAILURE = "Reconciliation required";
/** What the owners are told: moved now, or their scheduled change redirected. */
const MIGRATION_NOTICES = {
  migrated: "$saas.notifications.payload.plan_migrated",
  redirected: "$saas.notifications.payload.plan_change_redirected",
} as const;

/**
 * The operation a workspace's move runs under. A retry is a new operation:
 * reusing the first one's key would replay Stripe's cached answer to it.
 *
 * @param jobId Migration id
 * @param tenantId Workspace id
 * @param attempt Attempt number, from 1
 */
export function migrationOperationId(
  jobId: string,
  tenantId: string,
  attempt: number = FIRST_MIGRATION_ATTEMPT,
): string {
  const base = `migration:${jobId}:${tenantId}`;
  return attempt > FIRST_MIGRATION_ATTEMPT ? `${base}:${attempt}` : base;
}

/**
 * The status a migration settles in once nothing runs: uncertain workspaces
 * need an operator, failed ones a retry, workspaces kept on the source plan
 * close it as partially failed.
 *
 * @param outcomes Outcome of every captured workspace
 */
export function settledMigrationStatus(
  outcomes: PlanMigrationTenantOutcome[],
): PlanMigrationStatus {
  const statuses = new Set(outcomes.map((outcome) => outcome.status));
  if (statuses.has("reconciliation_required") || statuses.has("running"))
    return "reconciliation_required";
  if (statuses.has("failed")) return "failed";
  if (statuses.has("kept")) return "partially_failed";
  return "completed";
}

/**
 * Stripe refused the plan change outright — a declined card, an archived
 * price, a subscription gone: the request had no effect, so the workspace did
 * not move and a retry is safe. Raised for the provider change alone; a
 * refusal after it (the seat sync) leaves a workspace that did move.
 */
class ProviderChangeRefusedError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ProviderChangeRefusedError";
  }
}

function isRefusedMove(error: unknown): boolean {
  return error instanceof ProviderChangeRefusedError;
}

async function changeProviderPlanOrRefuse(
  work: WorkspaceMigration,
): Promise<void> {
  try {
    await changeProviderPlan(work);
  } catch (error) {
    if (isDefinitiveStripeRejection(error)) {
      throw new ProviderChangeRefusedError(error);
    }
    throw error;
  }
}

/**
 * The progress fields a set of workspace outcomes stands for: who moved, and
 * who did not with why.
 *
 * @param tenantOutcomes Outcome of every workspace handled so far
 */
export function migrationProgress(
  tenantOutcomes: PlanMigrationTenantOutcome[],
): Partial<PlanMigration> {
  const processedTenantIds = tenantOutcomes
    .filter((row) => row.status === "succeeded")
    .map((row) => row.tenantId);
  return {
    tenantOutcomes,
    processedTenantIds,
    processedWorkspaces: processedTenantIds.length,
    failedWorkspaces: tenantOutcomes.filter(isNotMovedOutcome).map((row) => ({
      tenantId: row.tenantId,
      error: row.error ?? UNKNOWN_FAILURE,
    })),
  };
}

interface WorkspaceMigration {
  tenantId: string;
  operationId: string;
  subscription: TenantSubscription;
  target: PlanMigrationTarget;
  seatQuantity: number;
  /**
   * The workspace is not on the retired plan but scheduled to switch to it:
   * its scheduled change is redirected to the target, nothing moves now.
   */
  isScheduledChange: boolean;
}

/**
 * What a migration does to a workspace it captured: on the retired plan, it
 * moves now; scheduled to switch to it, the scheduled change goes to the
 * target instead, or it would land on a plan that no longer exists.
 */
function capturedBy(
  subscription: TenantSubscription | undefined,
  fromPlanId: string,
): "move" | "redirect" | null {
  if (subscription?.planId === fromPlanId) return "move";
  if (subscription?.pendingPlanId === fromPlanId) return "redirect";
  return null;
}

/**
 * Takes from the workspace's roles every permission its new plan lacks.
 *
 * @param tenantId Workspace id
 * @param permissions Permissions of the plan it is now on, resolved
 */
export async function applyPermissionCleanup(
  tenantId: string,
  permissions: string[],
): Promise<void> {
  const roleModel = GetModel(RoleModel, tenantId);
  const allowedPermissions = new Set(permissions);
  const roles = await roleModel.table.run();
  for (const role of roles) {
    const filtered = (role.permissions ?? []).filter(
      (permission: string) =>
        permission === ALL_PERMISSIONS || allowedPermissions.has(permission),
    );
    if (filtered.length === (role.permissions ?? []).length) continue;
    await roleModel.update(role._id, { permissions: filtered });
  }
}

/** Remove permissions outside the resolved target plan. */
export async function applyPlanDowngradeCleanup(
  tenantId: string,
  newPlan: Plan,
): Promise<void> {
  const resolved = await GetModel(PlanModel).resolveInheritance(newPlan);
  await runTenantLifecycleOperation(tenantId, () =>
    applyPermissionCleanup(tenantId, resolved.permissions),
  );
}

async function changeProviderPlan(work: WorkspaceMigration): Promise<void> {
  const subscriptionId = work.subscription.stripeSubscriptionId;
  if (!subscriptionId) return;
  const stripe = getStripeClient();
  if (!work.target.stripePriceId) {
    await stripe.subscriptions.cancel(subscriptionId, undefined, {
      idempotencyKey: work.operationId,
    });
    return;
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) throw new Error("Stripe subscription has no plan item");
  await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [{ id: itemId, price: work.target.stripePriceId }],
      proration_behavior: PRORATION_BEHAVIOR,
    },
    { idempotencyKey: work.operationId },
  );
}

async function redirectScheduledChange(
  work: WorkspaceMigration,
): Promise<void> {
  await redirectPendingPlanChange({
    tenantId: work.tenantId,
    subscription: work.subscription,
    operationId: work.operationId,
    target: work.target,
  });
}

async function applyWorkspaceMigration(
  work: WorkspaceMigration,
): Promise<void> {
  if (work.isScheduledChange) return redirectScheduledChange(work);
  await changeProviderPlanOrRefuse(work);
  const subscriptionModel = GetModel(TenantSubscriptionModel, work.tenantId);
  const freePlanPatch: Partial<TenantSubscription> = work.target.stripePriceId
    ? {}
    : {
        status: "active",
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
      };
  await subscriptionModel.updateDuringTransition(
    work.subscription._id,
    work.operationId,
    {
      ...freePlanPatch,
      planId: work.target.planId,
      updatedAt: new Date(),
    },
  );
  await applyPermissionCleanup(work.tenantId, work.target.permissions);
  await syncStripeSeatQuantity({
    tenantId: work.tenantId,
    plan: work.target,
    stripeSubscriptionId: work.target.stripePriceId
      ? work.subscription.stripeSubscriptionId
      : null,
    idempotencyKey: `seat-sync:${work.operationId}`,
    quantityOverride: work.seatQuantity,
  });
}

async function snapshotMigration(
  job: PlanMigration,
): Promise<PlanMigrationSnapshot> {
  const planModel = GetModel(PlanModel);
  const target = await planModel.get(job.toPlanId);
  if (!target || target.isDeleted || !target.isActive)
    throw new Error("Target plan is unavailable");
  const resolved = await planModel.resolveInheritance(target);
  const model = GetModel(TenantSubscriptionModel, CROSS_INSTANCE);
  const [onPlan, scheduledToPlan] = await Promise.all([
    model.findByPlan(job.fromPlanId),
    model.findByPendingPlan(job.fromPlanId),
  ]);
  return {
    tenantIds: [
      ...new Set([...onPlan, ...scheduledToPlan].map(getRowInstance)),
    ],
    target: {
      planId: target._id,
      name: target.name,
      billingMode: target.billingMode,
      stripePriceId: target.paymentProviderRefs?.stripePriceId ?? null,
      permissions: resolved.permissions,
    },
  };
}

async function recordTenantOutcome(
  job: PlanMigration,
  outcome: RecordedTenantOutcome,
): Promise<void> {
  await GetModel(PlanMigrationModel).checkpoint(
    job,
    migrationProgress(withTenantOutcome(job.tenantOutcomes, outcome)),
  );
  void publishMigrationChange(job._id);
}

async function admitWorkspace(
  job: PlanMigration,
  tenantId: string,
  attempt: number,
): Promise<WorkspaceMigration> {
  if (!job.snapshot) throw new Error("Migration snapshot is missing");
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await model.findOne();
  const capture = capturedBy(subscription, job.fromPlanId);
  if (!subscription || !capture)
    throw new Error("Snapshot subscription changed; reconciliation required");
  const seatQuantity = await countOccupiedSeats(tenantId);
  await recordTenantOutcome(job, {
    tenantId,
    status: "running",
    error: null,
    seatQuantity,
    attempt,
  });
  const operationId = migrationOperationId(job._id, tenantId, attempt);
  await model.beginTransition(subscription, {
    operationId,
    kind: "change_plan",
    targetPlanId: job.snapshot.target.planId,
    requestedAt: job.createdAt,
  });
  return {
    tenantId,
    operationId,
    subscription,
    target: job.snapshot.target,
    seatQuantity,
    isScheduledChange: capture === "redirect",
  };
}

/**
 * Stripe refused the change outright: nothing moved, so the workspace's
 * intent is released and it can be retried under a new operation.
 */
async function releaseRefusedMove(work: WorkspaceMigration): Promise<void> {
  await GetModel(TenantSubscriptionModel, work.tenantId).completeTransition(
    work.subscription._id,
    work.operationId,
    {},
  );
}

async function migrateTenant(
  job: PlanMigration,
  tenantId: string,
  attempt: number,
): Promise<void> {
  const work = await admitWorkspace(job, tenantId, attempt);
  try {
    await applyWorkspaceMigration(work);
  } catch (error) {
    if (isRefusedMove(error)) await releaseRefusedMove(work);
    throw error;
  }
  if (job.notifyMembers) {
    const payload = work.isScheduledChange
      ? MIGRATION_NOTICES.redirected
      : MIGRATION_NOTICES.migrated;
    await notifyTenantOwners(tenantId, planMigratedSubject, {
      eventId: work.operationId,
      icon: ICON_MIGRATION,
      title: `${payload}.title`,
      description: `${payload}.description`,
      params: { plan: work.target.name },
    });
  }
  await recordTenantOutcome(job, {
    tenantId,
    status: "succeeded",
    error: null,
    seatQuantity: work.seatQuantity,
    attempt,
  });
  await GetModel(TenantSubscriptionModel, tenantId).completeTransition(
    work.subscription._id,
    work.operationId,
    {},
  );
}

async function processTenantInJob(
  job: PlanMigration,
  tenantId: string,
  attempt: number = FIRST_MIGRATION_ATTEMPT,
): Promise<void> {
  try {
    await runTenantLifecycleOperation(tenantId, () =>
      migrateTenant(job, tenantId, attempt),
    );
  } catch (error) {
    await recordTenantOutcome(job, {
      tenantId,
      status: isRefusedMove(error) ? "failed" : "reconciliation_required",
      error: error instanceof Error ? error.message : String(error),
      seatQuantity:
        job.tenantOutcomes.find((row) => row.tenantId === tenantId)
          ?.seatQuantity ?? null,
      attempt,
    });
  }
}

/**
 * Keyed on globalThis rather than module scope: a hot reload re-evaluates this
 * module and replays the resume pass while the previous generation's executor
 * is still running in the same process.
 */
const LIVE_EXECUTORS_KEY: unique symbol = Symbol.for(
  "@antelopejs/dms-saas/plan-migration-executors",
);

interface LiveExecutorsHost {
  [LIVE_EXECUTORS_KEY]?: Set<string>;
}

function liveExecutors(): Set<string> {
  const host = globalThis as LiveExecutorsHost;
  host[LIVE_EXECUTORS_KEY] ??= new Set();
  return host[LIVE_EXECUTORS_KEY];
}

async function executePlanMigrationJob(jobId: string): Promise<void> {
  const model = GetModel(PlanMigrationModel);
  const job = await model.get(jobId);
  if (!job || job.status !== "pending") return;
  const snapshot = await snapshotMigration(job);
  if (!(await model.beginJob(job, snapshot))) return;
  for (const tenantId of snapshot.tenantIds)
    await processTenantInJob(job, tenantId);
  await settleJob(job);
}

async function settleJob(job: PlanMigration): Promise<void> {
  await GetModel(PlanMigrationModel).checkpoint(job, {
    status: settledMigrationStatus(job.tenantOutcomes),
    completedAt: new Date(),
  });
  void publishMigrationChange(job._id);
}

async function executeRetry(jobId: string): Promise<void> {
  const model = GetModel(PlanMigrationModel);
  const job = await model.get(jobId);
  if (!job) return;
  const retried = settledOutcomes(job).filter((row) => row.status === "failed");
  if (retried.length === 0 || !(await model.reopen(job))) return;
  for (const outcome of retried)
    await processTenantInJob(job, outcome.tenantId, outcome.attempt + 1);
  await settleJob(job);
}

/**
 * Moves again the workspaces of a settled migration known not to have moved
 * (`failed`), each under a new operation. Uncertain ones are left alone: an
 * operator settles them first. Runs once however many times it is asked.
 *
 * @param jobId Migration id
 */
export async function retryFailedPlanMigrationWorkspaces(
  jobId: string,
): Promise<void> {
  const executors = liveExecutors();
  if (executors.has(jobId)) return;
  executors.add(jobId);
  try {
    await executeRetry(jobId);
  } finally {
    executors.delete(jobId);
  }
}

/**
 * Execute a frozen snapshot once; interrupted jobs retain evidence and never
 * take over. The job is registered as live before `beginJob`, so no running
 * row is ever observable in this process without its executor being visible to
 * the resume pass.
 */
export async function processPlanMigrationJob(jobId: string): Promise<void> {
  const executors = liveExecutors();
  if (executors.has(jobId)) return;
  executors.add(jobId);
  try {
    await executePlanMigrationJob(jobId);
  } finally {
    executors.delete(jobId);
  }
}

/**
 * Resume only unstarted jobs. A running job whose executor is still live in
 * this process is left alone, so the pass is safe to replay on every reload;
 * one without a live executor was interrupted and requires reconciliation.
 */
export async function resumePendingPlanMigrations(): Promise<void> {
  const model = GetModel(PlanMigrationModel);
  for (const job of await model.findResumable()) {
    if (job.status !== "running") {
      await processPlanMigrationJob(job._id);
      continue;
    }
    if (liveExecutors().has(job._id)) continue;
    await model.markInterrupted(job);
  }
}
