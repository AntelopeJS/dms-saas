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
import { TenantMember, TenantMemberModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { User } from "@antelopejs/interface-dms/auth/db";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HiddenStringFilter } from "./hidden-filter";

const COLUMN = "$saas.workspace_detail.members.column";
const ROLE = "$saas.workspace_detail.members.role";

// A member reads "active now" while their last request is this recent.
const ACTIVE_NOW_WITHIN_MS = 300_000;

const USER_JOIN = { table: User, localKey: "userId" } as const;

/** The members of one workspace (scoped by `_instance`), as an operator lists them. */
@RegisterDataController()
@AuthOwnerOnly()
export class membersDataAPI extends DataController(
  TenantMember,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/tables/members"),
) {
  @ModelReference()
  @Model(TenantMemberModel, CROSS_INSTANCE)
  declare model: TenantMemberModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare userId: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;

  @Listable(["userId"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.member`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    size: 260,
    display: new DefaultDisplays.IdentityDisplay({
      subtitleField: "email",
      selfField: "userId",
      selfLabel: "$saas.workspace_detail.members.you",
      badges: [
        {
          field: "isPlatformAdmin",
          label: `${ROLE}.platform_support`,
          tone: "info",
        },
      ],
    }),
  })
  @Joined({ ...USER_JOIN, remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable(["userId"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.email`,
    type: new DefaultDataTypes.EmailType(),
    filterable: true,
    isVisible: false,
  })
  @Joined({ ...USER_JOIN, remoteField: "email" })
  @Access(AccessMode.ReadOnly)
  declare email: string;

  @Listable(["userId"])
  @Joined({ ...USER_JOIN, remoteField: "owner" })
  @Access(AccessMode.ReadOnly)
  declare isPlatformAdmin: boolean;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${COLUMN}.role`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
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
  declare isTenantOwner: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.joined`,
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare joinedAt: Date;

  @Listable(["userId"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.last_active`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      nowWithinMs: ACTIVE_NOW_WITHIN_MS,
      nowLabel: "$saas.workspace_detail.members.active_now",
      emptyLabel: "$saas.workspace_detail.members.never",
    }),
  })
  @Joined({ ...USER_JOIN, remoteField: "lastActiveAt" })
  @Access(AccessMode.ReadOnly)
  declare lastActiveAt: Date | null;
}
