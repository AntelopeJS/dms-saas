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
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  PLAN_AUDIENCES,
  PLAN_BILLING_MODES,
  PLAN_INTERVALS,
  Plan,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";

const AUDIENCE_ITEMS = PLAN_AUDIENCES.map((value) => ({
  value,
  label: `$saas.plans.audience.${value}`,
}));

const INTERVAL_ITEMS = PLAN_INTERVALS.map((value) => ({
  value,
  label: `$saas.plans.interval.${value}`,
}));

const BILLING_MODE_ITEMS = PLAN_BILLING_MODES.map((value) => ({
  value,
  label: `$saas.plans.billing_mode.${value}`,
}));

const CURRENCY_ITEMS = [
  { value: "EUR", label: "EUR (€)" },
  { value: "USD", label: "USD ($)" },
];

interface PlanRowInstance {
  table: { _id: string };
}

function planIdOf(self: unknown): string {
  return (self as PlanRowInstance).table._id;
}

@RegisterDataController()
@AuthOwnerOnly()
export class plansDataAPI extends DataController(
  Plan,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    ...TableViewRoutes.ExportRoutes,
  },
  Controller("/api/saas/tables/plans"),
) {
  @ModelReference()
  @Model(PlanModel)
  declare model: PlanModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.name",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.audience",
    type: new DefaultDataTypes.SelectType({ items: AUDIENCE_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare audience: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.price",
    type: new DefaultDataTypes.PriceType(),
  })
  @Access(AccessMode.ReadOnly)
  declare price: number;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.plans.field.currency",
    type: new DefaultDataTypes.SelectType({ items: CURRENCY_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.interval",
    type: new DefaultDataTypes.SelectType({ items: INTERVAL_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare interval: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.plans.field.billing_mode",
    type: new DefaultDataTypes.SelectType({ items: BILLING_MODE_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare billingMode: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.trial_days",
    type: new DefaultDataTypes.NumberType({ min: 0 }),
  })
  @Access(AccessMode.ReadOnly)
  declare trialDays: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.max_members",
    type: new DefaultDataTypes.NumberType({ min: -1 }),
  })
  @Access(AccessMode.ReadOnly)
  declare maxMembers: number;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.plans.column.workspaces",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  get workspaceCount(): PromiseLike<number> {
    return GetModel(TenantSubscriptionModel, CROSS_INSTANCE).countByPlan(
      planIdOf(this),
    );
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.is_public",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare isPublic: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.is_active",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare isActive: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.plans.field.order",
    type: new DefaultDataTypes.NumberType({ min: 0 }),
  })
  @Access(AccessMode.ReadOnly)
  declare order: number;

  @Select()
  @Column({
    name: "$saas.plans.field.is_deleted",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare isDeleted: boolean;
}
