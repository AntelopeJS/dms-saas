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
import { Model } from "@antelopejs/interface-database-decorators";
import { UserInvite, UserInviteModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { StatusType } from "@antelopejs/interface-dms/base/data-types/status-type";
import { invitationStatusOf } from "../../workspaces/invitations";
import { HiddenStringFilter } from "./hidden-filter";

interface InviteRowInstance {
  table: Pick<UserInvite, "expiresAt">;
}

function inviteRowOf(self: unknown): Pick<UserInvite, "expiresAt"> {
  return (self as InviteRowInstance).table;
}

/**
 * Invitations not accepted yet, across workspaces. The token is deliberately
 * not listed: handing out the signup link goes through the journaled
 * copy-link route.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class invitationsDataAPI extends DataController(
  UserInvite,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/tables/invitations"),
) {
  @ModelReference()
  @Model(UserInviteModel, CROSS_INSTANCE)
  declare model: UserInviteModel;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;

  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.users.column.email",
    type: new DefaultDataTypes.EmailType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare email: string;

  @Listable()
  @Exported()
  @Column({
    name: "$saas.users.workspace_owner_badge",
    type: new DefaultDataTypes.BooleanType(),
  })
  @Access(AccessMode.ReadOnly)
  declare asTenantOwner: boolean;

  @Listable(["expiresAt"])
  @Exported()
  @Column({
    name: "$saas.workspaces.invitations.column.status",
    type: new StatusType({
      onlineLabel: "$saas.workspaces.invitations.status.pending",
      offlineLabel: "$saas.workspaces.invitations.status.expired",
      onlineColor: "primary",
      offlineColor: "neutral",
    }),
  })
  @Access(AccessMode.ReadOnly)
  get status(): boolean {
    return invitationStatusOf(inviteRowOf(this)) === "pending";
  }

  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.workspaces.invitations.column.sent_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;

  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.workspaces.invitations.column.expires_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare expiresAt: Date;
}
