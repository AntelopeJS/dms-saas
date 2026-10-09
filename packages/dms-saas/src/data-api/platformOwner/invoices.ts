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
  type CellSubline,
  Column,
  type ComposedText,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewMeta,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  Invoice,
  type InvoiceLine,
  InvoiceModel,
  type InvoiceStatus,
} from "../../db";
import { CREDITABLE_INVOICE_STATUSES } from "../../operator-billing/credit-allowance";
import { stripeDashboardUrl } from "../../stripe/client";
import {
  BillingPeriodDisplay,
  InvoiceLinesType,
  MoneyCentsType,
  statusPillDisplay,
  statusType,
} from "../../utils";
import { invoiceStatusDetail, invoiceWorkspaceDetail } from "./invoice-cells";
import { HiddenStringFilter } from "./hidden-filter";
import {
  INVOICE_COUNT_BATCH,
  INVOICE_GUARDS,
  INVOICE_LIST_OPTIONS,
} from "./invoice-options";
import {
  invoiceCreditedAmount,
  invoiceRow,
  invoiceSeats,
  replacingInvoiceNumber,
  workspacePlanName,
} from "./invoice-rows";

const COLUMN = "$saas.operator_billing.invoices.column";
const CREDITABLE_STATUSES: ReadonlySet<string> = new Set(
  CREDITABLE_INVOICE_STATUSES,
);

const withInvoiceScope = <O>(route: O) =>
  DefaultRoutes.WithOptions(
    route as Parameters<typeof DefaultRoutes.WithOptions>[0],
    INVOICE_LIST_OPTIONS,
  );

/**
 * Every workspace's invoices, for platform admins. Credit notes share the
 * table as negative rows for the workspace owners' history; this controller
 * never lists them.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class invoicesDataAPI extends DataController(
  Invoice,
  {
    get: TableViewRoutes.Get,
    list: withInvoiceScope(TableViewRoutes.List),
    select: withInvoiceScope(TableViewRoutes.Select),
    count: withInvoiceScope(TableViewRoutes.Count),
    countBatch: INVOICE_COUNT_BATCH,
    ...TableViewRoutes.ExportRoutes,
    exportStart: withInvoiceScope(TableViewRoutes.ExportRoutes.exportStart),
  },
  Controller("/api/saas/tables/invoices"),
) {
  // Enforce the guard even when no TableView page mounts this controller.
  static {
    GetMetadata(invoicesDataAPI, TableViewMeta).setControllerGuards(
      INVOICE_GUARDS,
    );
  }

  @ModelReference()
  @Model(InvoiceModel, CROSS_INSTANCE)
  declare model: InvoiceModel;

  @Select()
  @Listable()
  @Filter()
  @Access(AccessMode.ReadOnly)
  declare documentType: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.number`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay(),
    filterable: true,
    size: 150,
  })
  @Access(AccessMode.ReadOnly)
  declare number: string | null;

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
    name: `${COLUMN}.workspace`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.TwoLineDisplay({ subField: "planDetail" }),
    filterable: true,
    size: 220,
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare workspaceName: string;

  @Listable(["_instance"])
  @Exported()
  @Access(AccessMode.ReadOnly)
  get planName(): PromiseLike<string | null> {
    return workspacePlanName(invoiceRow(this)._instance);
  }

  @Listable(["_instance", "lines"])
  @Access(AccessMode.ReadOnly)
  get planDetail(): PromiseLike<ComposedText | string | null> {
    const row = invoiceRow(this);
    return workspacePlanName(row._instance).then((planName) =>
      invoiceWorkspaceDetail(planName, invoiceSeats(row.lines)),
    );
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.amount`,
    type: new MoneyCentsType(),
    size: 120,
  })
  @Access(AccessMode.ReadOnly)
  declare total: number;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.status`,
    type: statusType("invoice"),
    display: statusPillDisplay("invoice", {
      subField: "statusDetail",
      subTone: "muted",
    }),
    filterable: true,
    size: 240,
  })
  @Access(AccessMode.ReadOnly)
  declare status: InvoiceStatus;

  @Select()
  @Listable()
  @Column({
    name: `${COLUMN}.due_at`,
    type: new DefaultDataTypes.DateType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare dueAt: Date | null;

  @Listable([
    "status",
    "attemptCount",
    "nextPaymentAttemptAt",
    "dueAt",
    "autoFinalizesAt",
    "_instance",
    "latestRevisionStripeId",
  ])
  @Access(AccessMode.ReadOnly)
  get statusDetail(): PromiseLike<CellSubline | null> {
    const row = invoiceRow(this);
    return replacingInvoiceNumber(
      row._instance,
      row.latestRevisionStripeId,
    ).then((replacedBy) => invoiceStatusDetail(row, replacedBy));
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.period`,
    type: new DefaultDataTypes.DateType(),
    display: new BillingPeriodDisplay({ endField: "periodEnd" }),
    size: 190,
  })
  @Access(AccessMode.ReadOnly)
  declare periodStart: Date | null;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare periodEnd: Date | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.issued_at`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
    size: 110,
  })
  @Access(AccessMode.ReadOnly)
  declare issuedAt: Date;

  @Listable(["_instance", "_id"])
  @Exported()
  @Column({
    name: `${COLUMN}.credited`,
    type: new MoneyCentsType(),
    size: 110,
  })
  @Access(AccessMode.ReadOnly)
  get credited(): PromiseLike<number | null> {
    const row = invoiceRow(this);
    return invoiceCreditedAmount(row._instance, row._id);
  }

  @Listable(["status"])
  @Access(AccessMode.ReadOnly)
  get isCreditable(): boolean {
    return CREDITABLE_STATUSES.has(invoiceRow(this).status);
  }

  @Select()
  @Column({
    name: `${COLUMN}.lines`,
    type: new InvoiceLinesType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare lines: InvoiceLine[];

  @Select()
  @Column({
    name: `${COLUMN}.subtotal`,
    type: new MoneyCentsType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare subtotal: number;

  @Select()
  @Column({
    name: `${COLUMN}.tax`,
    type: new MoneyCentsType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare tax: number;

  @Select()
  @Column({
    name: `${COLUMN}.paid_at`,
    type: new DefaultDataTypes.DateType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare paidAt: Date | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare stripeInvoiceId: string;

  @Listable(["stripeInvoiceId"])
  @Access(AccessMode.ReadOnly)
  get stripeUrl(): string {
    return stripeDashboardUrl(`/invoices/${invoiceRow(this).stripeInvoiceId}`);
  }

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare hostedInvoiceUrl: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare invoicePdfUrl: string | null;
}
