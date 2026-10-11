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
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { StatusType } from "@antelopejs/interface-dms/base/data-types/status-type";
import { invitationStatusOf } from "../../workspaces/invitations";
import { MS_PER_DAY } from "../../utils/time";
import { HiddenStringFilter } from "./hidden-filter";

const COLUMN = "$saas.workspace_detail.invitations.column";
const ROLE = "$saas.workspace_detail.members.role";

// An invitation about to lapse turns amber this many days ahead.
const EXPIRING_SOON_DAYS = 2;

interface InviteRowInstance {
  table: Pick<UserInvite, "expiresAt">;
}

function inviteRowOf(self: unknown): Pick<UserInvite, "expiresAt"> {
  return (self as InviteRowInstance).table;
}

/**
 * Invitations not accepted yet, across workspaces (scoped by `_instance`).
 * Each one holds a seat. The token is deliberately not listed: handing out
 * the signup link goes through the journaled copy-link route.
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
    name: `${COLUMN}.email`,
    type: new DefaultDataTypes.EmailType(),
    filterable: true,
    size: 240,
  })
  @Access(AccessMode.ReadOnly)
  declare email: string;

  @Listable()
  @Exported()
  @Column({
    name: `${COLUMN}.role`,
    type: new DefaultDataTypes.BooleanType(),
    display: new DefaultDisplays.IndicatorDisplay({
      onLabel: `${ROLE}.workspace_owner`,
      offLabel: `${ROLE}.member`,
      onIcon: "i-ph-crown-simple",
      offIcon: "i-ph-user",
      onTone: "primary",
      offTone: "muted",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare asTenantOwner: boolean;

  @Listable(["expiresAt"])
  @Exported()
  @Column({
    name: `${COLUMN}.status`,
    type: new StatusType({
      onlineLabel: "$saas.status.owner.invited",
      offlineLabel: "$saas.status.owner.expired",
      onlineColor: "warning",
      offlineColor: "error",
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
    name: `${COLUMN}.sent_at`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;

  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.expires_at`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      soonWithinMs: EXPIRING_SOON_DAYS * MS_PER_DAY,
      soonTone: "warning",
      pastStyle: "day",
      pastTone: "error",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare expiresAt: Date;
}
