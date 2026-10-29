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
  type ComposedText,
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
} from "../../db";
import { composed, listDateFormat, valueText } from "../../i18n/composed-text";
import { dateTimeParam } from "../../plans/migration-blocks";
import { migrationTotals } from "../../plans/migration-detail";
import { statusPillDisplay, statusType } from "../../utils/status-vocabulary";
import { HiddenStringFilter } from "./hidden-filter";

const TEXTS = "$saas.catalog.migrations";
const ARROW = "→";
const LIVE_STATUSES = ["pending", "running"];
/** What `migrationTotals` reads off a migration. */
const TOTALS_FIELDS = [
  "status",
  "snapshot",
  "tenantOutcomes",
  "totalWorkspaces",
  "notifyMembers",
];
const PROGRESS_COLUMN_SIZE = 170;
const STATUS_COLUMN_SIZE = 210;
const REASON_KEY = "saas.catalog.migrations.reason";
const PERSON_COLUMN_SIZE = 150;
const TITLE_COLUMN_SIZE = 240;
const DATE_COLUMN_SIZE = 130;

const REASON_ITEMS = PLAN_MIGRATION_REASONS.map((value) => ({
  value,
  label: `${TEXTS}.reason.${value}`,
}));

const STAGE_ITEMS = PLAN_MIGRATION_STAGES.map((value) => ({
  value,
  label: `${TEXTS}.stage.${value}`,
}));

interface MigrationRowInstance {
  table: PlanMigration;
}

function listDateTime(date: Date): ComposedText {
  const at = new Date(date);
  return valueText(dateTimeParam(at, listDateFormat(at, new Date())));
}

function migrationOf(self: unknown): PlanMigration {
  return (self as MigrationRowInstance).table;
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

  @Listable(["fromPlanName", "toPlanName"])
  @Column({
    name: `${TEXTS}.column.migration`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-arrows-clockwise",
      subtitleField: "reasonLabel",
    }),
    size: TITLE_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get title(): string {
    const migration = migrationOf(this);
    return `${migration.fromPlanName} ${ARROW} ${migration.toPlanName}`;
  }

  @Select()
  @Listable()
  @Searchable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare fromPlanName: string;

  @Select()
  @Listable()
  @Searchable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare toPlanName: string;

  @Select()
  @Listable()
  @Column({
    name: `${TEXTS}.column.reason`,
    type: new DefaultDataTypes.SelectType({ items: REASON_ITEMS }),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare reason: string;

  @Listable(["reason"])
  @Access(AccessMode.ReadOnly)
  get reasonLabel(): ComposedText {
    return composed(`${REASON_KEY}.${migrationOf(this).reason}`);
  }

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
  declare stage: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.progress`,
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.ProgressDisplay({
      doneField: "reachedCount",
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

  /**
   * The bar draws the failed share inside the done one: done counts every
   * workspace the run reached, moved or not, and the red end the ones that did
   * not move (uncertain and unreached ones included).
   */
  @Listable(TOTALS_FIELDS)
  @Access(AccessMode.ReadOnly)
  get reachedCount(): number {
    const totals = migrationTotals(migrationOf(this));
    return totals.moved + totals.notMoved;
  }

  @Listable(TOTALS_FIELDS)
  @Access(AccessMode.ReadOnly)
  get notMovedCount(): number {
    return migrationTotals(migrationOf(this)).notMoved;
  }

  @Listable(["initiatedBy"])
  @Column({
    name: `${TEXTS}.column.started_by`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({}),
    size: PERSON_COLUMN_SIZE,
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
    display: new DefaultDisplays.TwoLineDisplay({ primaryField: "startedOn" }),
    size: DATE_COLUMN_SIZE,
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
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "finishedOn",
      emptyLabel: `${TEXTS}.column.not_finished`,
    }),
    size: DATE_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare completedAt: Date | null;

  /** A migration runs for minutes: the lists date it to the minute. */
  @Listable(["createdAt"])
  @Access(AccessMode.ReadOnly)
  get startedOn(): ComposedText {
    return listDateTime(migrationOf(this).createdAt);
  }

  @Listable(["completedAt"])
  @Access(AccessMode.ReadOnly)
  get finishedOn(): ComposedText | null {
    const { completedAt } = migrationOf(this);
    return completedAt ? listDateTime(completedAt) : null;
  }

  @Listable(["status"])
  @Access(AccessMode.ReadOnly)
  get isLive(): boolean {
    return LIVE_STATUSES.includes(migrationOf(this).status);
  }
}
