import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type {
  Plan,
  PlanMigration,
  PlanMigrationSnapshot,
  PlanMigrationTarget,
  PlanMigrationTenantOutcome,
  TenantSubscription,
} from "../db";
import { PlanMigrationModel, PlanModel, TenantSubscriptionModel } from "../db";
import { notifyTenantMembers, planMigratedSubject } from "../notifications";
import { countOccupiedSeats, syncStripeSeatQuantity } from "../plans";
import { getStripeClient } from "../stripe/client";
import { getRowInstance } from "../utils";

const ALL_PERMISSIONS = "*";
const ICON_MIGRATION = "i-ph-stack";
const PRORATION_BEHAVIOR = "create_prorations" as const;

interface WorkspaceMigration {
  tenantId: string;
  operationId: string;
  subscription: TenantSubscription;
  target: PlanMigrationTarget;
  seatQuantity: number;
}

async function applyPermissionCleanup(
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
    await stripe.subscriptions.cancel(subscriptionId, {
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

async function applyWorkspaceMigration(
  work: WorkspaceMigration,
): Promise<void> {
  await changeProviderPlan(work);
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
  const subscriptions = await GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  ).findByPlan(job.fromPlanId);
  return {
    tenantIds: [...new Set(subscriptions.map(getRowInstance))],
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
  outcome: PlanMigrationTenantOutcome,
): Promise<void> {
  const tenantOutcomes = [
    ...job.tenantOutcomes.filter((row) => row.tenantId !== outcome.tenantId),
    outcome,
  ];
  const processedTenantIds = tenantOutcomes
    .filter((row) => row.status === "succeeded")
    .map((row) => row.tenantId);
  await GetModel(PlanMigrationModel).checkpoint(job, {
    tenantOutcomes,
    processedTenantIds,
    processedWorkspaces: processedTenantIds.length,
    failedWorkspaces: tenantOutcomes
      .filter((row) => row.status === "reconciliation_required")
      .map((row) => ({
        tenantId: row.tenantId,
        error: row.error ?? "Reconciliation required",
      })),
  });
}

async function admitWorkspace(
  job: PlanMigration,
  tenantId: string,
): Promise<WorkspaceMigration> {
  if (!job.snapshot) throw new Error("Migration snapshot is missing");
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await model.findOne();
  if (!subscription || subscription.planId !== job.fromPlanId)
    throw new Error("Snapshot subscription changed; reconciliation required");
  const seatQuantity = await countOccupiedSeats(tenantId);
  await recordTenantOutcome(job, {
    tenantId,
    status: "running",
    error: null,
    seatQuantity,
  });
  const operationId = `migration:${job._id}:${tenantId}`;
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
  };
}

async function migrateTenant(
  job: PlanMigration,
  tenantId: string,
): Promise<void> {
  const work = await admitWorkspace(job, tenantId);
  await applyWorkspaceMigration(work);
  if (job.notifyMembers) {
    await notifyTenantMembers(tenantId, planMigratedSubject, {
      eventId: work.operationId,
      icon: ICON_MIGRATION,
      title: "Plan changed",
      description: `Your plan changed to ${work.target.name}.`,
    });
  }
  await recordTenantOutcome(job, {
    tenantId,
    status: "succeeded",
    error: null,
    seatQuantity: work.seatQuantity,
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
): Promise<void> {
  try {
    await runTenantLifecycleOperation(tenantId, () =>
      migrateTenant(job, tenantId),
    );
  } catch (error) {
    await recordTenantOutcome(job, {
      tenantId,
      status: "reconciliation_required",
      error: error instanceof Error ? error.message : String(error),
      seatQuantity:
        job.tenantOutcomes.find((row) => row.tenantId === tenantId)
          ?.seatQuantity ?? null,
    });
  }
}

/** Execute a frozen snapshot once; interrupted jobs retain evidence and never take over. */
export async function processPlanMigrationJob(jobId: string): Promise<void> {
  const model = GetModel(PlanMigrationModel);
  const job = await model.get(jobId);
  if (!job || job.status !== "pending") return;
  const snapshot = await snapshotMigration(job);
  if (!(await model.beginJob(job, snapshot))) return;
  for (const tenantId of snapshot.tenantIds)
    await processTenantInJob(job, tenantId);
  await model.checkpoint(job, {
    status: job.failedWorkspaces.length
      ? "reconciliation_required"
      : "completed",
    completedAt: new Date(),
  });
}

/** Resume only unstarted jobs; observed running jobs require executor-quiescence evidence. */
export async function resumePendingPlanMigrations(): Promise<void> {
  const model = GetModel(PlanMigrationModel);
  for (const job of await model.findResumable()) {
    if (job.status === "running") {
      await model.checkpoint(job, { status: "reconciliation_required" });
      continue;
    }
    await processPlanMigrationJob(job._id);
  }
}
