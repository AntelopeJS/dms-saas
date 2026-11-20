import { CROSS_INSTANCE, type Stream } from "@antelopejs/interface-database";
import {
  GetModel,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  type Invoice,
  InvoiceModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "./row-instance";

/** The per-workspace records a segment projection reads, keyed by workspace. */
export interface WorkspaceRecords {
  subscriptions: ReadonlyMap<string, TenantSubscription>;
  billingInfos: ReadonlyMap<string, TenantBillingInfo>;
  membersCounts: ReadonlyMap<string, number>;
  invoiceSummaries: ReadonlyMap<string, InvoiceSummary>;
}

/** What a projection reads of a workspace's invoices, credit notes left out. */
export interface InvoiceSummary {
  /** The `amount` of the paid invoices, summed whatever their currency. */
  paidAmount: number;
  lastIssuedAt: Date | null;
}

const PAID_STATUS = "paid";
const INVOICE_DOCUMENT_TYPE = "invoice";

/** The invoice summary of a workspace with no invoice. */
export const NO_INVOICE: InvoiceSummary = { paidAmount: 0, lastIssuedAt: null };

function summariseInvoices(invoices: Stream<Invoice>) {
  return {
    paidAmount: invoices
      .filter((invoice) => invoice.key("status").eq(PAID_STATUS))
      .sum("amount"),
    lastIssuedAt: invoices.max("issuedAt"),
  };
}

function toInvoiceSummary(
  row: { paidAmount: number; lastIssuedAt: number } | undefined,
): InvoiceSummary {
  if (!row) return NO_INVOICE;
  return {
    paidAmount: row.paidAmount,
    lastIssuedAt: new Date(row.lastIssuedAt),
  };
}

/** The invoice summary of one workspace. */
export async function loadInvoiceSummary(
  tenantId: string,
): Promise<InvoiceSummary> {
  const [row] = await GetModel(InvoiceModel, tenantId)
    .table.getAll(INVOICE_DOCUMENT_TYPE, "documentType")
    .group("documentType", summariseInvoices)
    .run();
  return toInvoiceSummary(row);
}

/** Each workspace's one row, as its model reads it, keyed by workspace. */
function byWorkspace<Row extends Table, T>(
  rows: (Row | null)[],
  read: (row: Row) => T | undefined,
): Map<string, T> {
  return new Map(
    rows.flatMap((row) => {
      if (row === null) return [];
      const value = read(row);
      return value === undefined ? [] : [[getRowInstance(row), value]];
    }),
  );
}

const INSTANCE_FIELD = "_instance";

/**
 * Every workspace's records in one read per table rather than one per
 * workspace: the subscription and billing details last updated, as
 * `findOne` picks them, the member count and the invoice summary.
 */
export async function loadWorkspaceRecords(): Promise<WorkspaceRecords> {
  const [subscriptionRows, billingInfoRows, memberCounts, invoiceRows] =
    await Promise.all([
      GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (rows) =>
          rows.orderBy("updatedAt", "desc").nth(0),
        )
        .run(),
      GetModel(TenantBillingInfoModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (rows) =>
          rows.orderBy("updatedAt", "desc").nth(0),
        )
        .run(),
      GetModel(TenantMemberModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (members, tenantId) => ({
          tenantId: tenantId.cast<string>(),
          count: members.count(),
        }))
        .run(),
      GetModel(InvoiceModel, CROSS_INSTANCE)
        .table.getAll(INVOICE_DOCUMENT_TYPE, "documentType")
        .group(INSTANCE_FIELD, (invoices, tenantId) => ({
          tenantId: tenantId.cast<string>(),
          ...summariseInvoices(invoices),
        }))
        .run(),
    ]);
  const membersCounts = new Map(
    memberCounts.map(({ tenantId, count }) => [tenantId, count]),
  );
  return {
    subscriptions: byWorkspace(subscriptionRows, (row) =>
      TenantSubscriptionModel.fromDatabase(row),
    ),
    billingInfos: byWorkspace(billingInfoRows, (row) =>
      TenantBillingInfoModel.fromDatabase(row),
    ),
    membersCounts,
    invoiceSummaries: new Map(
      invoiceRows.map((row) => [row.tenantId, toInvoiceSummary(row)]),
    ),
  };
}
