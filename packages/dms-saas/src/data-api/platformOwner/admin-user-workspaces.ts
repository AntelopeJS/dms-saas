import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Joined,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import {
  Tenant,
  TenantMember,
  TenantMemberModel,
} from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
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
  PlanModel,
  TenantBillingState,
  TenantSubscriptionModel,
} from "../../db";
import { statusPillDisplay, statusType } from "../../utils";
import { HiddenStringFilter } from "./hidden-filter";

const NO_PLAN = "—";
const NAME_COLUMN_SIZE = 240;

interface MembershipRowInstance {
  table: { _instance: string };
}

function tenantIdOf(self: unknown): string {
  return (self as MembershipRowInstance).table._instance;
}

/** The workspaces a user belongs to, with their place in each. */
@RegisterDataController()
@AuthOwnerOnly()
export class adminUserWorkspacesDataAPI extends DataController(
  TenantMember,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/admin/tables/user-workspaces"),
) {
  @ModelReference()
  @Model(TenantMemberModel, CROSS_INSTANCE)
  declare model: TenantMemberModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare userId: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;

  @Listable(["_instance"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: "$saas.users.workspaces.column.workspace",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    size: NAME_COLUMN_SIZE,
    display: new DefaultDisplays.IdentityDisplay({ icon: "i-ph-buildings" }),
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.workspaces.column.role",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    display: new DefaultDisplays.IndicatorDisplay({
      onLabel: "$saas.users.workspaces.role.owner",
      offLabel: "$saas.users.workspaces.role.member",
      onIcon: "i-ph-crown-simple",
      offIcon: "i-ph-user",
      onTone: "primary",
      offTone: "muted",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare isTenantOwner: boolean;

  @Listable(["_instance"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: "$saas.users.workspaces.column.status",
    type: statusType("workspace"),
    filterable: true,
    display: statusPillDisplay("workspace"),
  })
  @Joined({
    table: TenantBillingState,
    localKey: "_instance",
    remoteField: "billingState",
    remoteIndex: "_id",
  })
  @Access(AccessMode.ReadOnly)
  declare billingState: string;

  @Listable(["_instance"])
  @Exported()
  @Column({
    name: "$saas.users.workspaces.column.plan",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  get plan(): PromiseLike<string> {
    return GetModel(TenantSubscriptionModel, tenantIdOf(this))
      .findOne()
      .then(async (subscription) => {
        if (!subscription?.planId) return NO_PLAN;
        const plan = await GetModel(PlanModel).get(subscription.planId);
        return plan?.name ?? NO_PLAN;
      });
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.workspaces.column.joined_at",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
  })
  @Access(AccessMode.ReadOnly)
  declare joinedAt: Date;
}
