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
import { Tenant } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { CreditNote, CreditNoteModel } from "../../db";
import { HiddenStringFilter } from "./hidden-filter";

@RegisterDataController()
@AuthOwnerOnly()
export class creditNotesDataAPI extends DataController(
  CreditNote,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/tables/credit-notes"),
) {
  @ModelReference()
  @Model(CreditNoteModel, CROSS_INSTANCE)
  declare model: CreditNoteModel;

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
    name: "$saas.credit_notes.column.number",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare number: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;

  @Listable(["_instance"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: "$saas.credit_notes.column.workspace",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare workspaceName: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.credit_notes.column.amount",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare amount: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.credit_notes.column.type",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare type: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.credit_notes.column.status",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.credit_notes.column.issued_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare issuedAt: Date;
}
