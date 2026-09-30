// Readers for the Stripe fields that moved in API version 2025-03-31.basil.
//
// API calls made through the SDK always come back in the pinned version, but a
// webhook payload is rendered in the API version of the *endpoint* that
// receives it, which is configured in the Stripe Dashboard. Until an operator
// moves an endpoint to the pinned version, its events still carry the
// pre-basil shape, so every field that moved is read from its basil location
// first and from its legacy location second.

import type Stripe from "stripe";
import { stripeSecondsToDate } from "../utils/time";

/** Pre-basil `Subscription` fields, since moved onto each subscription item. */
interface LegacySubscriptionFields {
  current_period_start?: number | null;
  current_period_end?: number | null;
}

/** Pre-basil `Invoice` fields, since moved under `parent` and `total_taxes`. */
interface LegacyInvoiceFields {
  subscription?: string | Stripe.Subscription | null;
  tax?: number | null;
}

/** Pre-basil `CreditNote` fields, since replaced by `refunds` and `total_taxes`. */
interface LegacyCreditNoteFields {
  refund?: string | Stripe.Refund | null;
  tax_amounts?: TaxAmount[] | null;
}

interface TaxAmount {
  amount: number;
}

/** Start and end of a subscription's current billing period, in Stripe seconds. */
export interface StripeSubscriptionPeriod {
  start: number | null;
  end: number | null;
}

/** Any Stripe object a field may hold expanded instead of as an id. */
interface StripeReference {
  id?: string;
}

/** The id of a Stripe reference, whether it came as an id or expanded. */
export function readStripeId(
  value: string | StripeReference | null | undefined,
): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function sumAmounts(amounts: TaxAmount[] | null | undefined): number {
  return (amounts ?? []).reduce((total, entry) => total + entry.amount, 0);
}

/**
 * Since basil the billing period lives on each subscription item. Every item
 * of a dms-saas subscription shares one cycle, so the first item speaks for
 * the subscription.
 */
export function readSubscriptionPeriod(
  subscription: Stripe.Subscription,
): StripeSubscriptionPeriod {
  const item = subscription.items?.data?.[0];
  const legacy = subscription as Stripe.Subscription & LegacySubscriptionFields;
  return {
    start: item?.current_period_start ?? legacy.current_period_start ?? null,
    end: item?.current_period_end ?? legacy.current_period_end ?? null,
  };
}

/** When the subscription's current billing period ends. */
export function readSubscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  return stripeSecondsToDate(readSubscriptionPeriod(subscription).end);
}

/**
 * A finalized or draft invoice always carries an id; only previews lack one,
 * and those are never mirrored.
 */
export function requireInvoiceId(invoice: Stripe.Invoice): string {
  if (!invoice.id) throw new Error("Stripe invoice has no id");
  return invoice.id;
}

/** The subscription an invoice bills, or null for a one-off invoice. */
export function readInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (fromParent) return readStripeId(fromParent);
  return readStripeId(
    (invoice as Stripe.Invoice & LegacyInvoiceFields).subscription,
  );
}

/** Total tax an invoice carries, in minor units. */
export function readInvoiceTax(invoice: Stripe.Invoice): number {
  if (invoice.total_taxes) return sumAmounts(invoice.total_taxes);
  return (invoice as Stripe.Invoice & LegacyInvoiceFields).tax ?? 0;
}

/**
 * The refund a credit note returned money through. dms-saas issues at most one
 * refund per credit note, so the first entry is the one to mirror.
 */
export function readCreditNoteRefundId(
  creditNote: Stripe.CreditNote,
): string | null {
  const refund = creditNote.refunds?.[0]?.refund;
  if (refund) return readStripeId(refund);
  return readStripeId(
    (creditNote as Stripe.CreditNote & LegacyCreditNoteFields).refund,
  );
}

/** Tax carried by a credit note's lines, in minor units. */
export function readCreditNoteLineTax(creditNote: Stripe.CreditNote): number {
  if (creditNote.total_taxes) return sumAmounts(creditNote.total_taxes);
  return sumAmounts(
    (creditNote as Stripe.CreditNote & LegacyCreditNoteFields).tax_amounts,
  );
}
