// The lookups and row-mirroring shared by every Stripe webhook handler. They
// live apart from the handlers so each handler file stays under the size the
// linter allows, and so the split files depend on this one rather than on each
// other -- the dependency runs one way and introduces no cycle.

import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { recomputeTenantBillingState } from "../billing-state";
import type {
  InvoiceLine,
  InvoiceStatus,
  TenantSubscription,
  TenantSubscriptionStatus,
} from "../db";
import { InvoiceModel, TenantSubscriptionModel } from "../db";
import {
  getRowInstance,
  stripeSecondsToDate as optionalStripeDate,
} from "../utils";
import { getStripeClient } from "./client";

export const ACTIVE_STATUS: TenantSubscriptionStatus = "active";
export const TRIALING_STATUS: TenantSubscriptionStatus = "trialing";
export const PAST_DUE_STATUS: TenantSubscriptionStatus = "past_due";
export const CENTS_PER_UNIT = 100;

export interface TenantRef {
  _id: string;
}

export async function findTenantByCustomerId(
  customerId: string,
): Promise<TenantRef | null> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );
  const sub = await tenantSubscriptionModel.findOneByStripeCustomer(customerId);
  if (!sub) return null;
  return { _id: getRowInstance(sub) };
}

export async function updateSubscriptionStatus(
  tenantId: string,
  status: TenantSubscriptionStatus,
): Promise<void> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await tenantSubscriptionModel.findOne();
  if (!subscription) return;
  const patch: Partial<TenantSubscription> = {
    status,
    updatedAt: new Date(),
  };
  // Entering past_due arms the dunning clock unless an episode is already
  // running; leaving it disarms structurally (see DunningClock on the table).
  if (status === PAST_DUE_STATUS) {
    patch.pastDueSince = subscription.pastDueSince ?? new Date();
  }
  await tenantSubscriptionModel.update(subscription._id, patch);
  await recomputeTenantBillingState(tenantId);
}

export function formatAmount(amountInCents: number, currency: string): string {
  return `${(amountInCents / CENTS_PER_UNIT).toFixed(2)} ${currency.toUpperCase()}`;
}

export function asCustomerId(field: unknown): string | null {
  if (typeof field === "string") return field;
  return null;
}

export const INVOICE_LINES_PAGE_SIZE = 100;
const INVOICE_LINES_HARD_CAP = 1000;

export function toInvoiceLine(line: Stripe.InvoiceLineItem): InvoiceLine {
  return {
    description: line.description ?? "",
    quantity: line.quantity,
    amount: line.amount,
    currency: line.currency,
    periodStart: optionalStripeDate(line.period?.start),
    periodEnd: optionalStripeDate(line.period?.end),
  };
}

/**
 * The webhook payload embeds only the first page of the lines collection
 * while the invoice totals cover everything; mirroring just that page would
 * show a breakdown that does not add up to the displayed total. A fetch
 * failure propagates so Stripe's redelivery replays the upsert.
 */
export async function resolveInvoiceLines(
  invoice: Stripe.Invoice,
): Promise<InvoiceLine[]> {
  if (!invoice.lines.has_more) return invoice.lines.data.map(toInvoiceLine);
  const stripe = getStripeClient();
  const lines = await stripe.invoices
    .listLineItems(invoice.id, { limit: INVOICE_LINES_PAGE_SIZE })
    .autoPagingToArray({ limit: INVOICE_LINES_HARD_CAP });
  return lines.map(toInvoiceLine);
}

export async function upsertInvoice(
  invoice: Stripe.Invoice,
  tenantId: string,
): Promise<void> {
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const existing = await invoiceModel.findOneByStripeInvoice(invoice.id);
  const lines = await resolveInvoiceLines(invoice);
  const payload = {
    documentType: "invoice" as const,
    stripeInvoiceId: invoice.id,
    stripeCreditNoteId: null,
    number: invoice.number ?? null,
    parentInvoiceNumber: null,
    amount: invoice.amount_due,
    subtotal: invoice.subtotal,
    tax: invoice.tax ?? 0,
    total: invoice.total,
    currency: invoice.currency,
    status: (invoice.status ?? "open") as InvoiceStatus,
    creditNoteReason: null,
    creditNoteType: null,
    memo: null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    metadata: invoice.metadata ?? {},
    periodStart: optionalStripeDate(invoice.period_start),
    periodEnd: optionalStripeDate(invoice.period_end),
    lines,
    paidAt:
      invoice.status === "paid" && invoice.status_transitions.paid_at
        ? optionalStripeDate(invoice.status_transitions.paid_at)
        : null,
    voidedAt: null,
    issuedAt: optionalStripeDate(invoice.created) ?? new Date(),
    updatedAt: new Date(),
  };
  if (existing) {
    await invoiceModel.update(existing._id, payload);
  } else {
    await invoiceModel.insert({
      ...payload,
      createdAt: new Date(),
    });
  }
}

export interface MirroredInvoice {
  invoice: Stripe.Invoice;
  customerId: string;
  tenantId: string;
}

export interface MirroredCreditNote {
  creditNote: Stripe.CreditNote;
  tenantId: string;
  isCurrent: boolean;
}

export async function mirrorInvoiceFromEvent(
  event: Stripe.Event,
): Promise<MirroredInvoice | null> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = asCustomerId(invoice.customer);
  if (!customerId) return null;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return null;
  await upsertInvoice(invoice, tenant._id);
  return { invoice, customerId, tenantId: tenant._id };
}
