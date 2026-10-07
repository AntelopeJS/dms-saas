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
import { User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { UserSegmentModel } from "../../db";
import { getSegmentNamesCached, UserWorkspacesDisplay } from "../../utils";

const ACTIVE_NOW_MS = 5 * 60 * 1000;
const IDENTITY_COLUMN_SIZE = 280;

interface UserRowInstance {
  table: { _id: string };
}

/** How many workspaces a user owns and belongs to without owning. */
export interface UserWorkspaceCounts {
  owned: number;
  member: number;
}

function userIdOf(self: unknown): string {
  return (self as UserRowInstance).table._id;
}

// The three workspace getters read the same row, so they share one lookup.
const countsByRow = new WeakMap<object, Promise<UserWorkspaceCounts>>();

async function loadWorkspaceCounts(
  userId: string,
): Promise<UserWorkspaceCounts> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  const owned = memberships.filter((m) => m.member.isTenantOwner).length;
  return { owned, member: memberships.length - owned };
}

function rowWorkspaceCounts(self: unknown): Promise<UserWorkspaceCounts> {
  const row = self as object;
  let lookup = countsByRow.get(row);
  if (!lookup) {
    lookup = loadWorkspaceCounts(userIdOf(self));
    countsByRow.set(row, lookup);
  }
  return lookup;
}

@RegisterDataController()
@AuthOwnerOnly()
export class saasUsersDataAPI extends DataController(
  User,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
    ...TableViewRoutes.ExportRoutes,
  },
  Controller("/api/saas/tables/users"),
) {
  @ModelReference()
  @Model(UserModel)
  declare model: UserModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare avatar: User["avatar"];

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.users.column.user",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    size: IDENTITY_COLUMN_SIZE,
    display: new DefaultDisplays.IdentityDisplay({
      avatarField: "avatar",
      subtitleField: "email",
      selfField: "_id",
      selfLabel: "$saas.users.you",
      badges: [
        {
          field: "isValidated",
          equals: false,
          label: "$saas.users.unverified",
          tone: "warning",
        },
      ],
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.users.column.email",
    type: new DefaultDataTypes.EmailType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare email: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.column.platform_role",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    display: new DefaultDisplays.IndicatorDisplay({
      onLabel: "$saas.status.platform_role.admin",
      offLabel: "$saas.status.platform_role.none",
      onIcon: "i-ph-shield-check",
      onTone: "primary",
      offTone: "dimmed",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare owner: boolean;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.users.column.email_verified",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare isValidated: boolean;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.users.column.workspaces",
    type: new DefaultDataTypes.NumberType(),
    display: new UserWorkspacesDisplay({
      ownedField: "ownedWorkspaces",
      memberField: "memberWorkspaces",
    }),
  })
  @Access(AccessMode.ReadOnly)
  get workspaces(): PromiseLike<number> {
    return rowWorkspaceCounts(this).then(({ owned, member }) => owned + member);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get ownedWorkspaces(): PromiseLike<number> {
    return rowWorkspaceCounts(this).then(({ owned }) => owned);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get memberWorkspaces(): PromiseLike<number> {
    return rowWorkspaceCounts(this).then(({ member }) => member);
  }

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.users.column.segments",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.PillsDisplay({
      emptyLabel: "$saas.users.no_segment",
    }),
  })
  @Access(AccessMode.ReadOnly)
  get segments(): PromiseLike<string[]> {
    return GetModel(UserSegmentModel)
      .listByUser(userIdOf(this))
      .then(async (links) => {
        if (links.length === 0) return [];
        const namesById = await getSegmentNamesCached();
        return links
          .map((link) => namesById.get(link.segmentId))
          .filter((name): name is string => !!name)
          .sort((a, b) => a.localeCompare(b));
      });
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.column.last_active",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      nowWithinMs: ACTIVE_NOW_MS,
      nowLabel: "$saas.users.active_now",
      emptyLabel: "$saas.users.never_active",
      emptyTone: "dimmed",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare lastActiveAt: Date | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.column.created_at",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      style: "day",
      tone: "muted",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
