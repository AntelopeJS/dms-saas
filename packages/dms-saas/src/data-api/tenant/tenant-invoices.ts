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
import { Model } from "@antelopejs/interface-database-decorators";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { AuthUser } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type { InvoiceLine } from "../../db";
import { Invoice, InvoiceModel } from "../../db";
import {
  BillingDocumentType,
  BillingPeriodType,
  InvoiceLinesType,
  MoneyCentsType,
} from "../../utils";

@RegisterDataController()
@AuthUser()
export class tenantInvoicesDataAPI extends DataController(
  Invoice,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
  },
  Controller("/api/saas/tenant/tables/invoices"),
) {
  @ModelReference()
  @Model(InvoiceModel, (ctx) => getRequestTenantId(ctx))
  declare model: InvoiceModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.type",
    type: new BillingDocumentType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare documentType: string;

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
  @Column({
    name: "$saas.invoices.column.parent_invoice",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare parentInvoiceNumber: string | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.period",
    type: new BillingPeriodType(),
  })
  @Access(AccessMode.ReadOnly)
  declare periodStart: Date | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare periodEnd: Date | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.subtotal",
    type: new MoneyCentsType(),
  })
  @Access(AccessMode.ReadOnly)
  declare subtotal: number;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.tax",
    type: new MoneyCentsType(),
  })
  @Access(AccessMode.ReadOnly)
  declare tax: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.invoices.column.total",
    type: new MoneyCentsType(),
  })
  @Access(AccessMode.ReadOnly)
  declare total: number;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare amount: number;

  @Select()
  @Listable()
  @Column({
    name: "$saas.invoices.column.lines",
    type: new InvoiceLinesType(),
  })
  @Access(AccessMode.ReadOnly)
  declare lines: InvoiceLine[];

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
  @Column({
    name: "$saas.invoices.column.credit_note_reason",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare creditNoteReason: string | null;

  @Select()
  @Listable()
  @Column({
    name: "$saas.invoices.column.credit_note_type",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare creditNoteType: string | null;

  @Select()
  @Listable()
  @Column({
    name: "$saas.invoices.column.memo",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare memo: string | null;

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
  @Column({
    name: "$saas.invoices.column.voided_at",
    type: new DefaultDataTypes.DateType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare voidedAt: Date | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare hostedInvoiceUrl: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare invoicePdfUrl: string | null;
}
