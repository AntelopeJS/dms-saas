import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
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
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Invoice, InvoiceModel } from "../../db";
import {
  BillingDocumentType,
  BillingPeriodType,
  MoneyCentsType,
  statusPillDisplay,
  statusType,
} from "../../utils";
import { HiddenStringFilter } from "./hidden-filter";

const FIRST_MEMBERSHIP_INDEX = 0;

interface WorkspaceMembership {
  _instance: string;
  isTenantOwner: boolean;
}

/**
 * The invoices and credit notes of the workspaces a user owns: what they are
 * billed, across workspaces. A workspace they only belong to is billed to its
 * own owner.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class adminUserInvoicesDataAPI extends DataController(
  Invoice,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/admin/tables/user-invoices"),
) {
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
          .filter((member) => {
            const membership = member.cast<WorkspaceMembership>();
            return membership
              .key("isTenantOwner")
              .eq(true)
              .and(membership.key("_instance").eq(row.key("_instance")));
          })
          .map(() => true)
          .nth(FIRST_MEMBERSHIP_INDEX),
      ),
  )
  declare userId: string;

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

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Listable(["_instance"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: "$saas.users.billing.column.workspace",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    display: new DefaultDisplays.IdentityDisplay({ icon: "i-ph-buildings" }),
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
    name: "$saas.users.billing.column.number",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    display: new DefaultDisplays.MonoDisplay(),
  })
  @Access(AccessMode.ReadOnly)
  declare number: string | null;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.users.billing.column.type",
    type: new BillingDocumentType(),
  })
  @Access(AccessMode.ReadOnly)
  declare documentType: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.billing.column.period",
    type: new BillingPeriodType(),
  })
  @Access(AccessMode.ReadOnly)
  declare periodStart: Date | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.billing.column.status",
    type: statusType("invoice"),
    filterable: true,
    display: statusPillDisplay("invoice"),
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.billing.column.total",
    type: new MoneyCentsType(),
  })
  @Access(AccessMode.ReadOnly)
  declare total: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.users.billing.column.issued_at",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
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
