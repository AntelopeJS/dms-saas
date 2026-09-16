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
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { ReadonlyBehaviorType } from "@antelopejs/interface-dms/base/types";
import { PlanMigration, PlanMigrationModel } from "../../db";

@RegisterDataController()
@AuthOwnerOnly()
export class planMigrationsDataAPI extends DataController(
  PlanMigration,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
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

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.plans.migrations.column.from",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare fromPlanId: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.plans.migrations.column.to",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare toPlanId: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.migrations.column.status",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.plans.migrations.column.processed",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare processedWorkspaces: number;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.plans.migrations.column.total",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare totalWorkspaces: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.migrations.column.created_at",
    type: new DefaultDataTypes.DateType(),
    readonlyBehavior: {
      edit: ReadonlyBehaviorType.disabled,
      view: ReadonlyBehaviorType.disabled,
      new: ReadonlyBehaviorType.hidden,
    },
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.migrations.column.completed_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare completedAt: Date | null;
}
