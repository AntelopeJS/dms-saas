import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import {
  FeatureModel,
  type Plan,
  type PlanMigrationFailedWorkspace,
  type PlanMigrationFeatureDiff,
  type PlanMigrationReason,
  PlanMigrationModel,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import {
  type PlanUsageRow,
  isBilledSubscription,
  loadPlanUsageRows,
  normalisedMonthlyAmount,
} from "../../plans/catalogue-usage";
import {
  type FeatureChange,
  type PlanChangeKind,
  changeKind,
  diffPlanFeatures,
  memberCapChange,
} from "../../plans/plan-diff";
import { slugify } from "../../plans/plan-write";
import { getRowInstance } from "../../utils/row-instance";
import { processPlanMigrationJob } from "../../workers";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const PAST_DUE_STATUS = "past_due";
const CONFIRM_TEXT_FIELD = "confirmText";
const CONFIRM_TEXT_MISMATCH = "$saas.errors.plan.retire_confirm_mismatch";
const RETIRE_REASON: PlanMigrationReason = "plan_retired";

interface RetireBody {
  targetPlanId: string;
  notifyMembers?: boolean;
  confirmText?: string;
}

/** A plan as the retire dialog names it. */
interface RetirePlanSummary {
  _id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  interval: Plan["interval"];
  billingMode: Plan["billingMode"];
  maxMembers: number;
}

/** One workspace on the plan being retired. */
interface RetireWorkspace {
  tenantId: string;
  name: string;
  members: number;
  status: TenantSubscription["status"];
  renewsAt: Date | null;
}

/** Step 1 of the retire dialog: who is on the plan, and what they pay. */
interface RetireImpact {
  plan: RetirePlanSummary;
  workspaces: number;
  paying: number;
  pastDue: number;
  members: number;
  mrr: number;
  firstRenewal: Date | null;
  lastRenewal: Date | null;
  rows: RetireWorkspace[];
  targets: RetirePlanSummary[];
  hasOpenMigration: boolean;
}

/** A permission gained or lost, named as the roles editor names it. */
interface PermissionChange {
  id: string;
  kind: PlanChangeKind;
}

/** Step 2: what changes for the workspaces moving to the target plan. */
interface RetirePreparation {
  target: RetirePlanSummary;
  features: FeatureChange[];
  members: { from: number; to: number; kind: PlanChangeKind; above: number };
  price: { kind: PlanChangeKind };
  permissions: PermissionChange[];
  recipients: number;
  sample: { workspaceName: string; members: number } | null;
}

function summarisePlan(plan: Plan): RetirePlanSummary {
  return {
    _id: plan._id,
    name: plan.name,
    slug: plan.slug || slugify(plan.name),
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    maxMembers: plan.maxMembers,
  };
}

/** The text an operator types to retire a plan: its slug. */
export function retireConfirmText(plan: Plan): string {
  return plan.slug || slugify(plan.name);
}

function renewalRange(rows: RetireWorkspace[]): [Date | null, Date | null] {
  const dates = rows
    .map((row) => row.renewsAt?.getTime())
    .filter((time): time is number => time !== undefined)
    .sort((left, right) => left - right);
  if (dates.length === 0) return [null, null];
  return [new Date(dates[0]), new Date(dates[dates.length - 1])];
}

function monthlyRevenue(plan: Plan, rows: PlanUsageRow[]): number {
  return rows
    .filter(isBilledSubscription)
    .reduce(
      (total, row) => total + normalisedMonthlyAmount(plan, row.seats),
      0,
    );
}

/**
 * How the member cap changes, and how many workspaces end up above it (they
 * keep their members but cannot invite).
 */
export function memberCapDiff(
  fromPlan: Pick<Plan, "maxMembers">,
  toPlan: Pick<Plan, "maxMembers">,
  usage: Pick<PlanUsageRow, "seats">[],
): RetirePreparation["members"] {
  const isCapped = toPlan.maxMembers >= 0;
  return {
    from: fromPlan.maxMembers,
    to: toPlan.maxMembers,
    kind: memberCapChange(fromPlan.maxMembers, toPlan.maxMembers),
    above: isCapped
      ? usage.filter((row) => row.seats > toPlan.maxMembers).length
      : 0,
  };
}

function permissionChanges(from: string[], to: string[]): PermissionChange[] {
  const fromSet = new Set(from);
  const toSet = new Set(to);
  return [
    ...from
      .filter((id) => !toSet.has(id))
      .map((id) => ({ id, kind: "lost" as const })),
    ...to
      .filter((id) => !fromSet.has(id))
      .map((id) => ({ id, kind: "gained" as const })),
  ];
}

interface MigrationJobInput {
  fromPlan: Plan;
  targetPlan: Plan;
  notifyMembers: boolean;
  totalWorkspaces: number;
  initiatedBy: string;
  permissions: PermissionChange[];
}

function buildMigrationJobPayload(input: MigrationJobInput) {
  const permissionIds = (kind: PlanChangeKind) =>
    input.permissions.filter((row) => row.kind === kind).map((row) => row.id);
  return {
    fromPlanId: input.fromPlan._id,
    toPlanId: input.targetPlan._id,
    fromPlanName: input.fromPlan.name,
    toPlanName: input.targetPlan.name,
    reason: RETIRE_REASON,
    notifyMembers: input.notifyMembers,
    status: "pending" as const,
    totalWorkspaces: input.totalWorkspaces,
    processedWorkspaces: 0,
    processedTenantIds: [] as string[],
    failedWorkspaces: [] as PlanMigrationFailedWorkspace[],
    initiatedBy: input.initiatedBy,
    permissionDiff: {
      removed: permissionIds("lost"),
      added: permissionIds("gained"),
      unchanged: [] as string[],
    },
    featureDiff: {
      removed: [],
      added: [],
      changed: [],
    } as PlanMigrationFeatureDiff,
    startedAt: null as Date | null,
    completedAt: null as Date | null,
    createdAt: new Date(),
  };
}

/**
 * Retiring a plan: what it would take with it, what changes for its
 * workspaces on the target plan, and the snapshot migration that moves them.
 */
export class SaasPlanDeletionController extends Controller(
  "/api/saas/plans-deletion",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(FeatureModel)
  declare featureModel: FeatureModel;

  @Model(PlanMigrationModel)
  declare planMigrationModel: PlanMigrationModel;

  @Model(TenantSubscriptionModel, CROSS_INSTANCE)
  declare tenantSubscriptionModel: TenantSubscriptionModel;

  @Model(TenantModel)
  declare tenantModel: TenantModel;

  private async loadPlan(id: string): Promise<Plan> {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.source_not_found");
    return plan;
  }

  private async describeWorkspaces(
    planId: string,
    usage: PlanUsageRow[],
  ): Promise<RetireWorkspace[]> {
    const subscriptions = await this.tenantSubscriptionModel.findByPlan(planId);
    const byTenant = new Map(
      subscriptions.map((row) => [getRowInstance(row), row]),
    );
    const rows = await Promise.all(
      usage.map(async (row) => {
        const tenant = await this.tenantModel.get(row.tenantId);
        return {
          tenantId: row.tenantId,
          name: tenant?.name ?? row.tenantId,
          members: row.members,
          status: row.status,
          renewsAt: byTenant.get(row.tenantId)?.currentPeriodEnd ?? null,
        };
      }),
    );
    return rows.sort((left, right) => right.members - left.members);
  }

  private async retireTargets(fromPlanId: string): Promise<Plan[]> {
    const plans = await this.planModel.findActiveNotDeleted();
    return plans
      .filter((plan) => plan._id !== fromPlanId)
      .sort((left, right) => left.order - right.order);
  }

  /** Step 1 of the retire dialog: the workspaces, members and MRR at stake. */
  @Get("/:fromPlanId/impact")
  async impact(
    @AuthOwnerOnly() _user: User,
    @Parameter("fromPlanId") fromPlanId: string,
  ): Promise<RetireImpact> {
    const plan = await this.loadPlan(fromPlanId);
    const usage = await loadPlanUsageRows(fromPlanId);
    const [rows, targets, hasOpenMigration] = await Promise.all([
      this.describeWorkspaces(fromPlanId, usage),
      this.retireTargets(fromPlanId),
      this.planMigrationModel.existsPendingOrRunningForPlan(fromPlanId),
    ]);
    const [firstRenewal, lastRenewal] = renewalRange(rows);
    return {
      plan: summarisePlan(plan),
      workspaces: rows.length,
      paying: usage.filter(isBilledSubscription).length,
      pastDue: usage.filter((row) => row.status === PAST_DUE_STATUS).length,
      members: usage.reduce((total, row) => total + row.members, 0),
      mrr: monthlyRevenue(plan, usage),
      firstRenewal,
      lastRenewal,
      rows,
      targets: targets.map(summarisePlan),
      hasOpenMigration,
    };
  }

  private async countRecipients(tenantIds: string[]): Promise<number> {
    const owners = await Promise.all(
      tenantIds.map((tenantId) =>
        GetModel(TenantMemberModel, tenantId).listOwners(),
      ),
    );
    return owners.reduce((total, list) => total + list.length, 0);
  }

  /** Step 2: what changes for the workspaces, and who is told. */
  @Get("/:fromPlanId/prepare/:targetPlanId")
  async prepare(
    @AuthOwnerOnly() _user: User,
    @Parameter("fromPlanId") fromPlanId: string,
    @Parameter("targetPlanId") targetPlanId: string,
  ): Promise<RetirePreparation> {
    const [fromPlan, toPlan] = await Promise.all([
      this.planModel.get(fromPlanId),
      this.planModel.get(targetPlanId),
    ]);
    assert(fromPlan, HTTP_NOT_FOUND, "saas.errors.plan.source_not_found");
    assert(toPlan, HTTP_NOT_FOUND, "saas.errors.plan.target_not_found");
    const [fromAccess, toAccess, catalogue, usage] = await Promise.all([
      this.planModel.resolveInheritance(fromPlan),
      this.planModel.resolveInheritance(toPlan),
      this.featureModel.getAll(),
      loadPlanUsageRows(fromPlanId),
    ]);
    return {
      target: summarisePlan(toPlan),
      features: diffPlanFeatures(
        [...catalogue].sort((a, b) => a.order - b.order),
        fromAccess.features,
        toAccess.features,
      ),
      members: memberCapDiff(fromPlan, toPlan, usage),
      // Read from the customer's side: paying more is a loss.
      price: {
        kind: changeKind(
          normalisedMonthlyAmount(toPlan, 1),
          normalisedMonthlyAmount(fromPlan, 1),
        ),
      },
      permissions: permissionChanges(
        fromAccess.permissions,
        toAccess.permissions,
      ),
      recipients: await this.countRecipients(usage.map((row) => row.tenantId)),
      sample: await this.sampleWorkspace(usage),
    };
  }

  /** The largest workspace, which the notification preview is shown for. */
  private async sampleWorkspace(
    usage: PlanUsageRow[],
  ): Promise<RetirePreparation["sample"]> {
    const largest = [...usage].sort((a, b) => b.members - a.members)[0];
    if (!largest) return null;
    const tenant = await this.tenantModel.get(largest.tenantId);
    return {
      workspaceName: tenant?.name ?? largest.tenantId,
      members: largest.members,
    };
  }

  /**
   * Step 3: closes the plan to sign-ups and starts the snapshot migration of
   * its workspaces to the target plan. The operator types the plan's slug;
   * the server checks it. The plan itself is kept: it is deleted from the
   * catalogue once no workspace is left on it.
   */
  @Post("/:fromPlanId/migrate-and-delete")
  async migrateAndDelete(
    @AuthOwnerOnly() user: User,
    @Parameter("fromPlanId") fromPlanId: string,
    @JSONBody() body: RetireBody,
  ) {
    const fromPlan = await this.loadPlan(fromPlanId);
    this.assertConfirmText(fromPlan, body.confirmText);
    const targetPlan = await this.planModel.get(body.targetPlanId);
    assert(
      targetPlan &&
        !targetPlan.isDeleted &&
        targetPlan.isActive &&
        targetPlan._id !== fromPlanId,
      HTTP_BAD_REQUEST,
      "saas.errors.plan.target_must_be_active",
    );
    assert(
      !(await this.planMigrationModel.existsPendingOrRunningForPlan(
        fromPlanId,
      )),
      HTTP_CONFLICT,
      "saas.errors.migration.already_pending",
    );
    if (fromPlan.isActive) {
      await this.planModel.update(fromPlanId, {
        isActive: false,
        updatedAt: new Date(),
      });
    }
    const [fromAccess, toAccess] = await Promise.all([
      this.planModel.resolveInheritance(fromPlan),
      this.planModel.resolveInheritance(targetPlan),
    ]);
    const inserted = await this.planMigrationModel.insert([
      buildMigrationJobPayload({
        fromPlan,
        targetPlan,
        notifyMembers: body.notifyMembers ?? true,
        totalWorkspaces:
          await this.tenantSubscriptionModel.countByPlan(fromPlanId),
        initiatedBy: user._id,
        permissions: permissionChanges(
          fromAccess.permissions,
          toAccess.permissions,
        ),
      }),
    ]);
    const jobId = inserted[0];
    void processPlanMigrationJob(jobId).catch(() => {
      console.error("Plan migration requires inspection", jobId);
    });
    return {
      migrationId: jobId,
      sourcePlanRetained: true,
      scope: "captured_tenants_only",
    };
  }

  private assertConfirmText(plan: Plan, typed: string | undefined): void {
    if (typed?.trim() === retireConfirmText(plan)) return;
    throw new HTTPResult(HTTP_BAD_REQUEST, {
      message: CONFIRM_TEXT_MISMATCH,
      field: CONFIRM_TEXT_FIELD,
    });
  }
}
