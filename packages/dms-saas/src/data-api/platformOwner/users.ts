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
import { User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { UserSegmentModel } from "../../db";
import { getSegmentNamesCached } from "../../utils";

const NO_VALUE = "—";

interface UserRowInstance {
  table: { _id: string };
}

function userIdOf(self: unknown): string {
  return (self as UserRowInstance).table._id;
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

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: "$saas.users.column.name",
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
    name: "$saas.users.column.platform_owner",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare owner: boolean;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.users.column.segments",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  get segments(): PromiseLike<string> {
    return GetModel(UserSegmentModel)
      .listByUser(userIdOf(this))
      .then(async (links) => {
        if (links.length === 0) return NO_VALUE;
        const namesById = await getSegmentNamesCached();
        const names = links
          .map((l) => namesById.get(l.segmentId))
          .filter((name): name is string => !!name);
        return names.length > 0 ? names.join(", ") : NO_VALUE;
      });
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.column.created_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
