import { Controller, Get } from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { CreditNoteModel, InvoiceModel } from "../../db";
import {
  type BillingStats,
  computeCreditNoteStats,
  computeInvoiceStats,
  type CreditNoteRow,
  type OpenInvoiceRow,
  type PaidInvoiceRow,
  startOfMonth,
  startOfYear,
} from "../../operator-billing";

const INVOICE_DOCUMENT_TYPE = "invoice";
const OPEN_STATUS = "open";
const PAID_STATUS = "paid";
const UNCOLLECTIBLE_STATUS = "uncollectible";
const MONEY_FIELDS = ["amount", "currency"] as const;
const CREDIT_NOTE_FIELDS = [
  ...MONEY_FIELDS,
  "type",
  "status",
  "refundId",
  "metadata",
] as const;

/** The figures the operator's invoice and credit note lists show above them. */
export class SaasBillingStatsController extends Controller(
  "/api/saas/billing-stats",
) {
  @Model(InvoiceModel, CROSS_INSTANCE)
  declare invoiceModel: InvoiceModel;

  @Model(CreditNoteModel, CROSS_INSTANCE)
  declare creditNoteModel: CreditNoteModel;

  private openInvoices(): Promise<OpenInvoiceRow[]> {
    return this.invoiceModel.table
      .getAll(OPEN_STATUS, "status")
      .filter((row) => row.key("documentType").eq(INVOICE_DOCUMENT_TYPE))
      .pluck(...MONEY_FIELDS, "amountPaid", "nextPaymentAttemptAt")
      .run() as Promise<OpenInvoiceRow[]>;
  }

  private paidSince(since: Date): Promise<PaidInvoiceRow[]> {
    return this.invoiceModel.table
      .getAll(PAID_STATUS, "status")
      .filter((row) => row.key("paidAt").ge(since))
      .pluck(...MONEY_FIELDS, "amountPaid")
      .run() as Promise<PaidInvoiceRow[]>;
  }

  private writtenOffSince(since: Date): Promise<OpenInvoiceRow[]> {
    return this.invoiceModel.table
      .getAll(UNCOLLECTIBLE_STATUS, "status")
      .filter((row) => row.key("issuedAt").ge(since))
      .pluck(...MONEY_FIELDS)
      .run() as Promise<OpenInvoiceRow[]>;
  }

  private creditNotesSince(since: Date): Promise<CreditNoteRow[]> {
    return this.creditNoteModel.table
      .filter((row) => row.key("issuedAt").ge(since))
      .pluck(...CREDIT_NOTE_FIELDS)
      .run() as Promise<CreditNoteRow[]>;
  }

  @Get("/invoices")
  async invoices(@AuthOwnerOnly() _user: User): Promise<BillingStats> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const [open, paidThisMonth, creditNotesThisMonth, writtenOffThisYear] =
      await Promise.all([
        this.openInvoices(),
        this.paidSince(monthStart),
        this.creditNotesSince(monthStart),
        this.writtenOffSince(startOfYear(now)),
      ]);
    return computeInvoiceStats({
      open,
      paidThisMonth,
      creditNotesThisMonth,
      writtenOffThisYear,
    });
  }

  @Get("/credit-notes")
  async creditNotes(@AuthOwnerOnly() _user: User): Promise<BillingStats> {
    const notes = await this.creditNotesSince(startOfMonth(new Date()));
    return computeCreditNoteStats(notes);
  }
}
