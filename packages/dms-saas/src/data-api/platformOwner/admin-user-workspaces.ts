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
import { Model } from "@antelopejs/interface-database-decorators";
import {
  Tenant,
  TenantMember,
  TenantMemberModel,
} from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HiddenStringFilter } from "./hidden-filter";

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
    name: "$saas.workspaces.column.name",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.users.workspace_owner_badge",
    type: new DefaultDataTypes.BooleanType(),
  })
  @Access(AccessMode.ReadOnly)
  declare isTenantOwner: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.workspaces.column.created_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare joinedAt: Date;
}
