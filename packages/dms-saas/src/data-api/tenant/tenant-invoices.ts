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
  PAYMENT_FAILED_STATUS,
  statusItems,
  statusLabelKey,
  statusPillDisplay,
  statusType,
} from "../../utils";

/** The invoice fields its owner's status is read from. */
type PaymentStatusRow = Pick<Invoice, "status" | "attemptCount">;

interface PaymentStatusRowInstance {
  table: PaymentStatusRow;
}

// Sized so the columns and the inline "Pay invoice" fit the settings
// page without truncating a header or a pill.
const NUMBER_COLUMN_SIZE = 120;
const PERIOD_COLUMN_SIZE = 130;
const AMOUNT_COLUMN_SIZE = 120;
const TAX_COLUMN_SIZE = 80;
const STATUS_COLUMN_SIZE = 190;
const DATE_COLUMN_SIZE = 120;
const TENANT_COLUMN = "$saas.tenant_billing.invoices.column";

const PAYMENT_STATUS_TYPE = new DefaultDataTypes.SelectType({
  items: [
    ...statusItems("invoice"),
    {
      label: statusLabelKey("invoice", PAYMENT_FAILED_STATUS),
      value: PAYMENT_FAILED_STATUS,
    },
  ],
});

/**
 * An open invoice Stripe already tried to charge reads "Payment failed" to its
 * owner: "Open" says nothing about the declined card behind it.
 */
function invoicePaymentStatus(row: PaymentStatusRow): string {
  return row.status === "open" && row.attemptCount
    ? PAYMENT_FAILED_STATUS
    : row.status;
}

/**
 * The columns a customer reads an invoice by — document, period, amounts
 * before and after tax, status — are listed; line items and credit-note
 * details stay readable on the invoice's detail page, which reads every field.
 */
@RegisterDataController()
@AuthUser()
export class tenantInvoicesDataAPI extends DataController(
  Invoice,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
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
    isVisible: false,
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
    size: NUMBER_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare number: string | null;

  @Select()
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
    size: PERIOD_COLUMN_SIZE,
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
    name: `${TENANT_COLUMN}.excl_vat`,
    type: new MoneyCentsType(),
    size: AMOUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare subtotal: number;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TENANT_COLUMN}.vat`,
    type: new MoneyCentsType(),
    size: TAX_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare tax: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TENANT_COLUMN}.total`,
    type: new MoneyCentsType(),
    size: AMOUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare total: number;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare amount: number;

  @Select()
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
    type: statusType("invoice"),
    display: statusPillDisplay("invoice"),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Listable(["status", "attemptCount"])
  @Column({
    name: "$saas.invoices.column.status",
    type: PAYMENT_STATUS_TYPE,
    display: statusPillDisplay("invoice"),
    size: STATUS_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get paymentStatus(): string {
    return invoicePaymentStatus((this as unknown as PaymentStatusRowInstance).table);
  }

  @Select()
  @Column({
    name: "$saas.invoices.column.credit_note_reason",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare creditNoteReason: string | null;

  @Select()
  @Column({
    name: "$saas.invoices.column.credit_note_type",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare creditNoteType: string | null;

  @Select()
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
    size: DATE_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare issuedAt: Date;

  @Select()
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
