import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  PLAN_MIGRATION_REASONS,
  PLAN_MIGRATION_STAGES,
  PlanMigration,
  PlanMigrationModel,
  PlanModel,
} from "../../db";
import { statusPillDisplay, statusType } from "../../utils/status-vocabulary";

const TEXTS = "$saas.catalog.migrations";
const ARROW = "→";
const LIVE_STATUSES = ["pending", "running"];
const PROGRESS_COLUMN_SIZE = 180;
const STATUS_COLUMN_SIZE = 200;

const REASON_ITEMS = PLAN_MIGRATION_REASONS.map((value) => ({
  value,
  label: `${TEXTS}.reason.${value}`,
}));

const REASON_BADGES = PLAN_MIGRATION_REASONS.map((value) => ({
  field: "reason",
  equals: value,
  label: `${TEXTS}.reason.${value}`,
  tone: "neutral" as const,
}));

const STAGE_ITEMS = PLAN_MIGRATION_STAGES.map((value) => ({
  value,
  label: `${TEXTS}.stage.${value}`,
}));

interface MigrationRowInstance {
  table: PlanMigration;
}

function migrationOf(self: unknown): PlanMigration {
  return (self as MigrationRowInstance).table;
}

async function planName(
  stored: string | null | undefined,
  planId: string,
): Promise<string> {
  if (stored) return stored;
  const plan = await GetModel(PlanModel).get(planId);
  return plan?.name ?? planId;
}

/**
 * Moves of workspaces between plans, read-only: a migration is started by
 * retiring a plan and settled through `/api/saas/plan-migrations`.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class planMigrationsDataAPI extends DataController(
  PlanMigration,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
  },
  Controller("/api/saas/tables/plan-migrations"),
) {
  @ModelReference()
  @Model(PlanMigrationModel)
  declare model: PlanMigrationModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Listable(["fromPlanId", "toPlanId", "fromPlanName", "toPlanName"])
  @Column({
    name: `${TEXTS}.column.migration`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-arrows-clockwise",
      badges: REASON_BADGES,
    }),
    size: 280,
  })
  @Access(AccessMode.ReadOnly)
  get title(): Promise<string> {
    const migration = migrationOf(this);
    return Promise.all([
      planName(migration.fromPlanName, migration.fromPlanId),
      planName(migration.toPlanName, migration.toPlanId),
    ]).then(([from, to]) => `${from} ${ARROW} ${to}`);
  }

  @Select()
  @Listable()
  @Searchable()
  @Access(AccessMode.ReadOnly)
  declare fromPlanName: string | null;

  @Select()
  @Listable()
  @Searchable()
  @Access(AccessMode.ReadOnly)
  declare toPlanName: string | null;

  @Select()
  @Listable()
  @Column({
    name: `${TEXTS}.column.reason`,
    type: new DefaultDataTypes.SelectType({ items: REASON_ITEMS }),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare reason: string | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.status`,
    type: statusType("migration"),
    display: statusPillDisplay("migration"),
    filterable: true,
    size: STATUS_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Select()
  @Column({
    name: `${TEXTS}.column.stage`,
    type: new DefaultDataTypes.SelectType({ items: STAGE_ITEMS }),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare stage: string | null;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.progress`,
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.ProgressDisplay({
      doneField: "processedWorkspaces",
      totalField: "totalWorkspaces",
      errorField: "notMovedCount",
    }),
    size: PROGRESS_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare processedWorkspaces: number;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare totalWorkspaces: number;

  @Listable(["failedWorkspaces"])
  @Access(AccessMode.ReadOnly)
  get notMovedCount(): number {
    return migrationOf(this).failedWorkspaces?.length ?? 0;
  }

  @Listable(["initiatedBy"])
  @Column({
    name: `${TEXTS}.column.started_by`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({}),
  })
  @Access(AccessMode.ReadOnly)
  get startedBy(): PromiseLike<string> {
    const userId = migrationOf(this).initiatedBy;
    return GetModel(UserModel)
      .get(userId)
      .then((user) => user?.name || user?.email || userId);
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.started`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.finished`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      style: "day",
      emptyLabel: `${TEXTS}.column.not_finished`,
      emptyTone: "muted",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare completedAt: Date | null;

  @Listable(["status"])
  @Access(AccessMode.ReadOnly)
  get isLive(): boolean {
    return LIVE_STATUSES.includes(migrationOf(this).status);
  }
}
