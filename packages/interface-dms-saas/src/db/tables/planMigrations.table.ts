import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { Tenant } from "@antelopejs/interface-dms/db/tables/tenants.table";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { Plan, type PlanBillingMode } from "./plans.table";

export const planMigrationsTableName = "plan_migrations";

export const PLAN_MIGRATION_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "partially_failed",
  "reconciliation_required",
] as const;
export type PlanMigrationStatus = (typeof PLAN_MIGRATION_STATUSES)[number];

export interface PlanMigrationFailedWorkspace {
  tenantId: string;
  error: string;
}

export interface PlanMigrationTarget {
  planId: string;
  name: string;
  billingMode: PlanBillingMode;
  stripePriceId: string | null;
  permissions: string[];
}

export interface PlanMigrationSnapshot {
  tenantIds: string[];
  target: PlanMigrationTarget;
}

/**
 * Where one captured workspace stands: being moved, moved, left uncertain by
 * an interrupted or ambiguous provider call (`reconciliation_required`),
 * known not to have moved and safe to retry (`failed`), or left on the source
 * plan by an operator closing the migration (`kept`).
 */
export const PLAN_MIGRATION_TENANT_STATUSES = [
  "running",
  "succeeded",
  "reconciliation_required",
  "failed",
  "kept",
] as const;
export type PlanMigrationTenantStatus =
  (typeof PLAN_MIGRATION_TENANT_STATUSES)[number];

export interface PlanMigrationTenantOutcome {
  tenantId: string;
  status: PlanMigrationTenantStatus;
  error: string | null;
  seatQuantity: number | null;
  /** Attempts made for this workspace; a retry runs under a new operation. */
  attempt?: number;
  /** When the workspace last changed state, for the detail timeline. */
  updatedAt?: Date | null;
  /** Operator who resolved an uncertain outcome by hand. */
  resolvedBy?: string | null;
}

/**
 * Where a migration stands for the operator: moving workspaces, waiting for
 * someone (uncertain or failed workspaces), or done.
 */
export const PLAN_MIGRATION_STAGES = [
  "running",
  "needs_attention",
  "done",
] as const;
export type PlanMigrationStage = (typeof PLAN_MIGRATION_STAGES)[number];

const STAGE_BY_STATUS: Record<PlanMigrationStatus, PlanMigrationStage> = {
  pending: "running",
  running: "running",
  reconciliation_required: "needs_attention",
  failed: "needs_attention",
  completed: "done",
  partially_failed: "done",
};

/** The stage a migration status belongs to. */
export function planMigrationStageOf(
  status: PlanMigrationStatus,
): PlanMigrationStage {
  return STAGE_BY_STATUS[status];
}

/** Why a migration was started. */
export const PLAN_MIGRATION_REASONS = ["plan_retired"] as const;
export type PlanMigrationReason = (typeof PLAN_MIGRATION_REASONS)[number];

export interface PlanMigrationPermissionDiff {
  removed: string[];
  added: string[];
  unchanged: string[];
}

export interface PlanMigrationFeatureChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface PlanMigrationFeatureDiff {
  removed: string[];
  added: string[];
  changed: PlanMigrationFeatureChange[];
}

/** Progress and outcome of a bulk workspace plan migration. */
@RegisterTable(planMigrationsTableName, CORE_SCHEMA_NAME)
export class PlanMigration extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare revision: string;

  @Field("any")
  declare snapshot: PlanMigrationSnapshot | null;

  @Field("any")
  declare tenantOutcomes: PlanMigrationTenantOutcome[];

  @Index()
  @Field("string")
  @Relation({ to: () => Plan })
  declare fromPlanId: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Plan })
  declare toPlanId: string;

  @Field("boolean")
  declare notifyMembers: boolean;

  @Index()
  @Field("string")
  declare status: PlanMigrationStatus;

  /** Stage of `status`, kept with it so lists can filter on it. */
  @Index()
  @Field("string")
  declare stage?: PlanMigrationStage;

  @Field("number")
  declare totalWorkspaces: number;

  @Field("number")
  declare processedWorkspaces: number;

  @Field(["string"])
  @Relation({ to: () => Tenant, many: true })
  declare processedTenantIds: string[];

  @Field("any")
  declare failedWorkspaces: PlanMigrationFailedWorkspace[];

  @Field("string")
  @Relation({ to: () => User })
  declare initiatedBy: string;

  @Field("any")
  declare permissionDiff: PlanMigrationPermissionDiff;

  @Field("any")
  declare featureDiff: PlanMigrationFeatureDiff;

  /** Plan names when the migration started, for the list once one is gone. */
  @Field("string")
  declare fromPlanName?: string | null;

  @Field("string")
  declare toPlanName?: string | null;

  @Field("string")
  declare reason?: PlanMigrationReason | null;

  /** When an operator closed the migration with workspaces left behind. */
  @Field("date")
  declare reconciledAt?: Date | null;

  @Field("string")
  @Relation({ to: () => User })
  declare reconciledBy?: string | null;

  /** The operator's note for the audit log when reconciling. */
  @Field("string")
  declare reconciliationNote?: string | null;

  @Index()
  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare startedAt: Date | null;

  @Field("date")
  declare completedAt: Date | null;
}
