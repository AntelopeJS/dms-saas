import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  type PlanMigrationFailedWorkspace,
  type PlanMigrationFeatureDiff,
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import { processPlanMigrationJob } from "../../workers";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

interface DeleteWithMigrationBody {
  targetPlanId: string;
  notifyMembers?: boolean;
}

interface PermissionDiff {
  removed: string[];
  added: string[];
  unchanged: string[];
}

function diffPermissions(
  fromPermissions: string[],
  toPermissions: string[],
): PermissionDiff {
  const fromSet = new Set(fromPermissions);
  const toSet = new Set(toPermissions);
  const removed = fromPermissions.filter((p) => !toSet.has(p));
  const added = toPermissions.filter((p) => !fromSet.has(p));
  const unchanged = fromPermissions.filter((p) => toSet.has(p));
  return { removed, added, unchanged };
}

interface ValidatedPlanPair {
  fromPlan: Plan;
  targetPlan: Plan;
}

async function loadValidatedPlanPair(
  planModel: PlanModel,
  fromPlanId: string,
  targetPlanId: string,
): Promise<ValidatedPlanPair> {
  const fromPlan = await planModel.get(fromPlanId);
  assert(fromPlan, HTTP_NOT_FOUND, "saas.errors.plan.source_not_found");
  const targetPlan = await planModel.get(targetPlanId);
  assert(
    targetPlan && !targetPlan.isDeleted && targetPlan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.target_must_be_active",
  );
  return { fromPlan, targetPlan };
}

interface MigrationJobInput {
  fromPlanId: string;
  toPlanId: string;
  notifyMembers: boolean;
  totalWorkspaces: number;
  initiatedBy: string;
  permissionDiff: PermissionDiff;
}

function buildMigrationJobPayload(input: MigrationJobInput) {
  return {
    fromPlanId: input.fromPlanId,
    toPlanId: input.toPlanId,
    notifyMembers: input.notifyMembers,
    status: "pending" as const,
    totalWorkspaces: input.totalWorkspaces,
    processedWorkspaces: 0,
    processedTenantIds: [] as string[],
    failedWorkspaces: [] as PlanMigrationFailedWorkspace[],
    initiatedBy: input.initiatedBy,
    permissionDiff: input.permissionDiff,
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

export class SaasPlanDeletionController extends Controller(
  "/api/saas/plans-deletion",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(PlanMigrationModel)
  declare planMigrationModel: PlanMigrationModel;

  @Model(TenantSubscriptionModel, CROSS_INSTANCE)
  declare tenantSubscriptionModel: TenantSubscriptionModel;

  @Get("/migrations/:migrationId")
  async migrationStatus(
    @AuthOwnerOnly() _user: User,
    @Parameter("migrationId") migrationId: string,
  ) {
    const migration = await this.planMigrationModel.get(migrationId);
    assert(migration, HTTP_NOT_FOUND, "saas.errors.migration.not_found");
    return {
      migration,
      sourcePlanRetained: true,
      scope: "captured_tenants_only",
      reconciliation:
        "Establish prior executor quiescence and external outcomes before resolving pending subscription intents. A matching planId or Stripe read alone is insufficient.",
    };
  }

  @Get("/:fromPlanId/prepare/:targetPlanId")
  async prepare(
    @AuthOwnerOnly() _user: User,
    @Parameter("fromPlanId") fromPlanId: string,
    @Parameter("targetPlanId") targetPlanId: string,
  ) {
    const [fromPlan, toPlan] = await Promise.all([
      this.planModel.get(fromPlanId),
      this.planModel.get(targetPlanId),
    ]);
    assert(fromPlan, HTTP_NOT_FOUND, "saas.errors.plan.source_not_found");
    assert(toPlan, HTTP_NOT_FOUND, "saas.errors.plan.target_not_found");

    const affectedTenantsCount =
      await this.tenantSubscriptionModel.countByPlan(fromPlanId);

    const diff = diffPermissions(
      fromPlan.permissions ?? [],
      toPlan.permissions ?? [],
    );
    return {
      affectedTenantsCount,
      removedPermissions: diff.removed,
      addedPermissions: diff.added,
      unchangedPermissions: diff.unchanged,
    };
  }

  @Post("/:fromPlanId/migrate-and-delete")
  async migrateAndDelete(
    @AuthOwnerOnly() user: User,
    @Parameter("fromPlanId") fromPlanId: string,
    @JSONBody() body: DeleteWithMigrationBody,
  ) {
    const { fromPlan, targetPlan } = await loadValidatedPlanPair(
      this.planModel,
      fromPlanId,
      body.targetPlanId,
    );

    const hasPendingOrRunning =
      await this.planMigrationModel.existsPendingOrRunningForPlan(fromPlanId);
    assert(
      !hasPendingOrRunning,
      HTTP_CONFLICT,
      "saas.errors.migration.already_pending",
    );

    const totalWorkspaces =
      await this.tenantSubscriptionModel.countByPlan(fromPlanId);
    const diff = diffPermissions(
      fromPlan.permissions ?? [],
      targetPlan.permissions ?? [],
    );

    const inserted = await this.planMigrationModel.insert([
      buildMigrationJobPayload({
        fromPlanId,
        toPlanId: body.targetPlanId,
        notifyMembers: body.notifyMembers ?? true,
        totalWorkspaces,
        initiatedBy: user._id,
        permissionDiff: diff,
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
}
