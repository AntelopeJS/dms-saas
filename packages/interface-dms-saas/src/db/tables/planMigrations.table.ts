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

export interface PlanMigrationTenantOutcome {
  tenantId: string;
  status: "running" | "succeeded" | "reconciliation_required";
  error: string | null;
  seatQuantity: number | null;
}

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
  declare revision?: string;

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

  @Index()
  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare startedAt: Date | null;

  @Field("date")
  declare completedAt: Date | null;
}
