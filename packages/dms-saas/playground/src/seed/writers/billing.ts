import {
  CreditNoteModel,
  type InvoiceLine,
  InvoiceModel,
  RefundModel,
} from "@antelopejs/interface-dms-saas/db";
import { PLANS } from "../data/catalogue";
import type { SeedCreditNote, SeedInvoice } from "../data/types";
import { dayFrom, insertMissing, type SeedRow } from "./rows";

const PERCENT = 100;
const NUMBER_DIGITS = 4;
const FIRST_INVOICE_NUMBER = 871;
const FIRST_CREDIT_NOTE_NUMBER = 109;
const PAID_STATUS = "paid";
const VOID_STATUS = "void";

interface NumberedInvoice {
  invoice: SeedInvoice;
  number: string;
}

function documentNumber(prefix: string, date: Date, sequence: number): string {
  return `${prefix}-${date.getFullYear()}-${String(sequence).padStart(NUMBER_DIGITS, "0")}`;
}

/** Numbers follow the issue dates across every workspace, as Stripe's do. */
function numberInOrder<T>(
  documents: T[],
  issuedOn: (document: T) => number,
  format: (document: T, sequence: number) => string,
): Map<T, string> {
  const ordered = [...documents].sort(
    (left, right) => issuedOn(left) - issuedOn(right),
  );
  return new Map(
    ordered.map((document, index) => [document, format(document, index)]),
  );
}

function toLines(invoice: SeedInvoice): InvoiceLine[] {
  return invoice.lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    amount: line.quantity * line.unitAmount,
    currency: invoice.currency,
    periodStart: dayFrom(invoice.periodStartOn),
    periodEnd: dayFrom(invoice.periodEndOn),
  }));
}

function planName(planId: string | null): string | undefined {
  return PLANS.find((plan) => plan.id === planId)?.name;
}

function toInvoiceRow({ invoice, number }: NumberedInvoice): SeedRow {
  const subtotal = toLines(invoice).reduce((sum, line) => sum + line.amount, 0);
  const tax = Math.round((subtotal * invoice.taxRate) / PERCENT);
  const issuedAt = dayFrom(invoice.issuedOn);
  return {
    _id: invoice.id,
    documentType: "invoice",
    stripeInvoiceId: invoice.id,
    stripeCreditNoteId: null,
    number,
    parentInvoiceNumber: null,
    amount: subtotal + tax,
    subtotal,
    tax,
    total: subtotal + tax,
    currency: invoice.currency,
    periodStart: dayFrom(invoice.periodStartOn),
    periodEnd: dayFrom(invoice.periodEndOn),
    lines: toLines(invoice),
    status: invoice.status,
    creditNoteReason: null,
    creditNoteType: null,
    memo: null,
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    metadata: invoice.planId
      ? { planId: invoice.planId, planName: planName(invoice.planId) }
      : {},
    paidAt: invoice.status === PAID_STATUS ? issuedAt : null,
    voidedAt: invoice.status === VOID_STATUS ? issuedAt : null,
    issuedAt,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

async function writeInvoices(
  invoices: SeedInvoice[],
): Promise<Map<string, NumberedInvoice>> {
  const numbers = numberInOrder(
    invoices,
    (invoice) => invoice.issuedOn,
    (invoice, index) =>
      documentNumber(
        "INV",
        dayFrom(invoice.issuedOn),
        FIRST_INVOICE_NUMBER + index,
      ),
  );
  const numbered = invoices.map((invoice) => ({
    invoice,
    number: numbers.get(invoice) ?? invoice.id,
  }));
  for (const entry of numbered) {
    await insertMissing(
      InvoiceModel,
      [toInvoiceRow(entry)],
      entry.invoice.tenantId,
    );
  }
  return new Map(numbered.map((entry) => [entry.invoice.id, entry]));
}

interface CreditNoteContext {
  creditNote: SeedCreditNote;
  number: string;
  parent: NumberedInvoice;
}

function toCreditNoteRow({
  creditNote,
  number,
  parent,
}: CreditNoteContext): SeedRow {
  const issuedAt = dayFrom(creditNote.issuedOn);
  return {
    _id: creditNote.id,
    invoiceId: parent.invoice.id,
    stripeCreditNoteId: creditNote.id,
    number,
    amount: creditNote.amount,
    currency: parent.invoice.currency,
    reason: creditNote.reason,
    memo: creditNote.memo,
    type: creditNote.type,
    refundId: creditNote.refund?.id ?? null,
    hostedUrl: null,
    pdfUrl: null,
    status: creditNote.status,
    issuedAt,
    voidedAt: creditNote.status === VOID_STATUS ? issuedAt : null,
    metadata: {},
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

/** The credit note as the billing documents list shows it, beside invoices. */
function toCreditNoteDocumentRow({
  creditNote,
  number,
  parent,
}: CreditNoteContext): SeedRow {
  const issuedAt = dayFrom(creditNote.issuedOn);
  const line = {
    description: creditNote.memo,
    quantity: 1,
    amount: -creditNote.amount,
    currency: parent.invoice.currency,
    periodStart: dayFrom(parent.invoice.periodStartOn),
    periodEnd: dayFrom(parent.invoice.periodEndOn),
  };
  return {
    ...toInvoiceRow(parent),
    _id: creditNote.id,
    documentType: "credit_note",
    stripeCreditNoteId: creditNote.id,
    number,
    parentInvoiceNumber: parent.number,
    amount: -creditNote.amount,
    subtotal: -creditNote.amount,
    tax: 0,
    total: -creditNote.amount,
    lines: [line],
    status: creditNote.status,
    creditNoteReason: creditNote.reason,
    creditNoteType: creditNote.type,
    memo: creditNote.memo,
    paidAt: null,
    voidedAt: creditNote.status === VOID_STATUS ? issuedAt : null,
    issuedAt,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

function toRefundRow({ creditNote, parent }: CreditNoteContext): SeedRow[] {
  if (!creditNote.refund) return [];
  const issuedAt = dayFrom(creditNote.issuedOn);
  return [
    {
      _id: creditNote.refund.id,
      creditNoteId: creditNote.id,
      stripeRefundId: creditNote.refund.id,
      amount: creditNote.amount,
      currency: parent.invoice.currency,
      status: creditNote.refund.status,
      failureReason: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    },
  ];
}

async function writeCreditNote(context: CreditNoteContext): Promise<void> {
  const { tenantId } = context.parent.invoice;
  await insertMissing(CreditNoteModel, [toCreditNoteRow(context)], tenantId);
  await insertMissing(
    InvoiceModel,
    [toCreditNoteDocumentRow(context)],
    tenantId,
  );
  await insertMissing(RefundModel, toRefundRow(context), tenantId);
}

/**
 * Writes the invoices and the credit notes against them, each in its
 * workspace, as the Stripe webhooks mirror them.
 */
export async function writeBillingDocuments(
  invoices: SeedInvoice[],
  creditNotes: SeedCreditNote[],
): Promise<void> {
  const parents = await writeInvoices(invoices);
  const numbers = numberInOrder(
    creditNotes,
    (creditNote) => creditNote.issuedOn,
    (creditNote, index) =>
      documentNumber(
        "CN",
        dayFrom(creditNote.issuedOn),
        FIRST_CREDIT_NOTE_NUMBER + index,
      ),
  );
  for (const creditNote of creditNotes) {
    const parent = parents.get(creditNote.invoiceId);
    if (!parent)
      throw new Error(`Credit note ${creditNote.id} names no seeded invoice`);
    await writeCreditNote({
      creditNote,
      number: numbers.get(creditNote) ?? creditNote.id,
      parent,
    });
  }
}
