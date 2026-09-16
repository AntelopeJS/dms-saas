import { Controller } from "@antelopejs/interface-api";
import { GetMetadata } from "@antelopejs/interface-core";
import {
  DataController,
  DefaultRoutes,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Filter,
  type FilterFunction,
  Joined,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { CROSS_INSTANCE, ValueProxy } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { Tenant, TenantMemberModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewMeta,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Invoice, InvoiceModel } from "../../db";
import { HiddenStringFilter } from "./hidden-filter";
import { INVOICE_GUARDS, INVOICE_LIST_OPTIONS } from "./invoice-options";

const FIRST_MEMBERSHIP_INDEX = 0;

interface WorkspaceMembership {
  _instance: string;
}

@RegisterDataController()
@AuthOwnerOnly()
export class adminUserInvoicesDataAPI extends DataController(
  Invoice,
  {
    get: TableViewRoutes.Get,
    list: DefaultRoutes.WithOptions(TableViewRoutes.List, INVOICE_LIST_OPTIONS),
    select: DefaultRoutes.WithOptions(
      TableViewRoutes.Select,
      INVOICE_LIST_OPTIONS,
    ),
    count: DefaultRoutes.WithOptions(
      TableViewRoutes.Count,
      INVOICE_LIST_OPTIONS,
    ),
  },
  Controller("/api/saas/admin/tables/user-invoices"),
) {
  // Enforce the guard even when no TableView page mounts this controller.
  static {
    GetMetadata(adminUserInvoicesDataAPI, TableViewMeta).setControllerGuards(
      INVOICE_GUARDS,
    );
  }

  @ModelReference()
  @Model(InvoiceModel, CROSS_INSTANCE)
  declare model: InvoiceModel;

  @Filter(
    (
      ...[, , , userId, , row]: Parameters<
        FilterFunction<adminUserInvoicesDataAPI, adminUserInvoicesDataAPI>
      >
    ) =>
      ValueProxy.constant(true).eq(
        GetModel(TenantMemberModel, CROSS_INSTANCE)
          .table.getAll(userId, "userId")
          .filter((member) =>
            member
              .cast<WorkspaceMembership>()
              .key("_instance")
              .eq(row.key("_instance")),
          )
          .map(() => true)
          .nth(FIRST_MEMBERSHIP_INDEX),
      ),
  )
  declare userId: string;

  @Select()
  @Listable()
  @Filter()
  @Access(AccessMode.ReadOnly)
  declare documentType: string;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

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
    name: "$saas.invoices.column.workspace",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare workspaceName: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.number",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare number: string | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.amount",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare amount: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.status",
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
    name: "$saas.invoices.column.issued_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare issuedAt: Date;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare hostedInvoiceUrl: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare invoicePdfUrl: string | null;
}
