// The credit-note half of the Stripe webhook surface, split out of
// webhook-handlers.ts to keep every file under the size the linter allows.
// Shared lookups stay in webhook-handlers.ts and are imported from there: the
// dependency runs one way, so no cycle is introduced.

import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import type {
  CreditNoteStatus,
  CreditNoteType,
  Invoice,
  InvoiceLine,
} from "../db";
import { CreditNoteModel, InvoiceModel } from "../db";
import { creditNoteIssuedSubject, notifyTenantOwners } from "../notifications";
import { stripeSecondsToDate as optionalStripeDate } from "../utils";
import { getStripeClient } from "./client";
import {
  asCustomerId,
  findTenantByCustomerId,
  formatAmount,
  INVOICE_LINES_PAGE_SIZE,
  type MirroredCreditNote,
  upsertInvoice,
} from "./webhook-shared";

const CREDIT_NOTE_ICON = "i-ph-receipt";

function resolveCreditNoteInvoiceId(
  creditNote: Stripe.CreditNote,
): string | null {
  if (typeof creditNote.invoice === "string") return creditNote.invoice;
  return creditNote.invoice?.id ?? null;
}

function resolveCreditNoteRefundId(
  creditNote: Stripe.CreditNote,
): string | null {
  if (typeof creditNote.refund === "string") return creditNote.refund;
  return creditNote.refund?.id ?? null;
}

function toCreditNoteLine(
  line: Stripe.CreditNoteLineItem,
  currency: string,
): InvoiceLine {
  return {
    description: line.description ?? "",
    quantity: line.quantity,
    amount: -line.amount,
    currency,
    periodStart: null,
    periodEnd: null,
  };
}

async function resolveCreditNoteLines(
  creditNote: Stripe.CreditNote,
): Promise<InvoiceLine[]> {
  if (!creditNote.lines.has_more) {
    return creditNote.lines.data.map((line) =>
      toCreditNoteLine(line, creditNote.currency),
    );
  }
  const lines = getStripeClient().creditNotes.listLineItems(creditNote.id, {
    limit: INVOICE_LINES_PAGE_SIZE,
  });
  const allLines: InvoiceLine[] = [];
  await lines.autoPagingEach((line) => {
    allLines.push(toCreditNoteLine(line, creditNote.currency));
  });
  return allLines;
}

function resolveCreditNoteType(creditNote: Stripe.CreditNote): CreditNoteType {
  return creditNote.type;
}

function resolveCreditNoteTax(creditNote: Stripe.CreditNote): number {
  const lineTax = creditNote.tax_amounts.reduce(
    (total, taxAmount) => total + taxAmount.amount,
    0,
  );
  return lineTax + (creditNote.shipping_cost?.amount_tax ?? 0);
}

function buildCreditNotePayload(
  creditNote: Stripe.CreditNote,
  invoiceRowId: string,
) {
  const creditNoteStatus: CreditNoteStatus =
    creditNote.status === "void" ? "void" : "issued";
  return {
    invoiceId: invoiceRowId,
    stripeCreditNoteId: creditNote.id,
    number: creditNote.number,
    amount: creditNote.amount,
    currency: creditNote.currency,
    reason: creditNote.reason ?? "",
    memo: creditNote.memo,
    type: resolveCreditNoteType(creditNote),
    refundId: resolveCreditNoteRefundId(creditNote),
    hostedUrl: null,
    pdfUrl: creditNote.pdf ?? null,
    status: creditNoteStatus,
    issuedAt:
      optionalStripeDate(creditNote.effective_at ?? creditNote.created) ??
      new Date(),
    voidedAt: optionalStripeDate(creditNote.voided_at),
    metadata: creditNote.metadata ?? {},
    updatedAt: new Date(),
  };
}

function buildCreditNoteInvoicePayload(
  creditNote: Stripe.CreditNote,
  invoice: Invoice,
  lines: InvoiceLine[],
) {
  const tax = resolveCreditNoteTax(creditNote);
  return {
    documentType: "credit_note" as const,
    stripeInvoiceId: invoice.stripeInvoiceId,
    stripeCreditNoteId: creditNote.id,
    number: creditNote.number,
    parentInvoiceNumber: invoice.number,
    amount: -creditNote.amount,
    subtotal: -creditNote.subtotal,
    tax: -tax,
    total: -creditNote.total,
    currency: creditNote.currency,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    lines,
    status: creditNote.status,
    creditNoteReason: creditNote.reason,
    creditNoteType: resolveCreditNoteType(creditNote),
    memo: creditNote.memo,
    hostedInvoiceUrl: null,
    invoicePdfUrl: creditNote.pdf ?? null,
    metadata: creditNote.metadata ?? {},
    paidAt: null,
    voidedAt: optionalStripeDate(creditNote.voided_at),
    issuedAt:
      optionalStripeDate(creditNote.effective_at ?? creditNote.created) ??
      new Date(),
    updatedAt: new Date(),
  };
}

async function resolveMirroredInvoice(
  tenantId: string,
  stripeInvoiceId: string,
): Promise<Invoice | null> {
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const existing = await invoiceModel.findOneByStripeInvoice(stripeInvoiceId);
  if (existing?.number && existing.periodStart && existing.periodEnd) {
    return existing;
  }
  const stripeInvoice =
    await getStripeClient().invoices.retrieve(stripeInvoiceId);
  await upsertInvoice(stripeInvoice, tenantId);
  return (await invoiceModel.findOneByStripeInvoice(stripeInvoiceId)) ?? null;
}

async function upsertCreditNoteMirror(
  creditNote: Stripe.CreditNote,
  tenantId: string,
  invoice: Invoice,
): Promise<boolean> {
  const creditNoteModel = GetModel(CreditNoteModel, tenantId);
  const existing = await creditNoteModel.findOneByStripeCreditNote(
    creditNote.id,
  );
  const payload = buildCreditNotePayload(creditNote, invoice._id);
  if (existing) {
    if (creditNote.status === "void") {
      await creditNoteModel.update(existing._id, payload);
      return true;
    }
    return creditNoteModel.updateUnlessVoided(existing._id, payload);
  }
  await creditNoteModel.insert({
    ...payload,
    _id: creditNote.id,
    createdAt: new Date(),
  });
  return true;
}

async function upsertCreditNoteInvoiceRow(
  creditNote: Stripe.CreditNote,
  tenantId: string,
  invoice: Invoice,
  lines: InvoiceLine[],
): Promise<boolean> {
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const existing = await invoiceModel.findOneByStripeCreditNote(creditNote.id);
  const payload = buildCreditNoteInvoicePayload(creditNote, invoice, lines);
  if (existing) {
    if (creditNote.status === "void") {
      await invoiceModel.update(existing._id, payload);
      return true;
    }
    return invoiceModel.updateUnlessVoided(existing._id, payload);
  }
  await invoiceModel.insert({
    ...payload,
    _id: creditNote.id,
    createdAt: new Date(),
  });
  return true;
}

async function mirrorCreditNoteFromEvent(
  event: Stripe.Event,
): Promise<MirroredCreditNote | null> {
  const eventCreditNote = event.data.object as Stripe.CreditNote;
  const customerId = asCustomerId(eventCreditNote.customer);
  if (!customerId) return null;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return null;
  const creditNote = await getStripeClient().creditNotes.retrieve(
    eventCreditNote.id,
  );
  const stripeInvoiceId = resolveCreditNoteInvoiceId(creditNote);
  if (!stripeInvoiceId) {
    throw new Error(`Stripe credit note ${creditNote.id} has no invoice`);
  }
  const invoice = await resolveMirroredInvoice(tenant._id, stripeInvoiceId);
  if (!invoice) {
    throw new Error(`Could not mirror invoice ${stripeInvoiceId}`);
  }
  const lines = await resolveCreditNoteLines(creditNote);
  const canonicalUpdated = await upsertCreditNoteMirror(
    creditNote,
    tenant._id,
    invoice,
  );
  const invoiceUpdated = await upsertCreditNoteInvoiceRow(
    creditNote,
    tenant._id,
    invoice,
    lines,
  );
  return {
    creditNote,
    tenantId: tenant._id,
    isCurrent: canonicalUpdated && invoiceUpdated,
  };
}

export async function handleCreditNoteCreated(
  event: Stripe.Event,
): Promise<void> {
  const mirrored = await mirrorCreditNoteFromEvent(event);
  if (!mirrored) return;
  const { creditNote, tenantId, isCurrent } = mirrored;
  if (creditNote.status !== "issued" || !isCurrent) return;
  await notifyTenantOwners(tenantId, creditNoteIssuedSubject, {
    icon: CREDIT_NOTE_ICON,
    title: "Credit note issued",
    description: `A credit note of ${formatAmount(creditNote.amount, creditNote.currency)} was issued.`,
  });
}

export async function handleCreditNoteVoided(
  event: Stripe.Event,
): Promise<void> {
  await mirrorCreditNoteFromEvent(event);
}

/**
 * Checkout attaches the collected card to the subscription only; the customer
 * keeps no `invoice_settings.default_payment_method`, which is what the
 * billing page's payment-method card (and any future off-subscription
 * invoice) reads. Promote the subscription's card to customer default.
 */
