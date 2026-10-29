/**
 * Readers for the Stripe fields that moved in API version 2025-03-31.basil.
 *
 * API calls made through the SDK always come back in the pinned version, but a
 * webhook payload is rendered in the API version of the *endpoint* that
 * receives it, which is configured in the Stripe Dashboard. Until an operator
 * moves an endpoint to the pinned version, its events still carry the
 * pre-basil shape, so every field that moved is read from its basil location
 * first and from its legacy location second. The clover and dahlia releases
 * moved none of the fields read here, so their payloads take the basil path.
 *
 * @packageDocumentation
 */

import type Stripe from "stripe";
import { stripeSecondsToDate } from "../utils/time";
import { isString } from "../utils/primitive-guards";

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
  if (isString(value)) return value;
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
  subscription: Stripe.Subscription & LegacySubscriptionFields,
): StripeSubscriptionPeriod {
  const item = subscription.items?.data?.[0];
  return {
    start:
      item?.current_period_start ?? subscription.current_period_start ?? null,
    end: item?.current_period_end ?? subscription.current_period_end ?? null,
  };
}

/** A subscription's current billing period, as `TenantSubscription` stores it. */
export interface SubscriptionPeriodDates {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/** No billing period: a workspace without a Stripe subscription. */
export const NO_SUBSCRIPTION_PERIOD: SubscriptionPeriodDates = {
  currentPeriodStart: null,
  currentPeriodEnd: null,
};

/** The subscription's current billing period, ready to store. */
export function readSubscriptionPeriodDates(
  subscription: Stripe.Subscription,
): SubscriptionPeriodDates {
  const { start, end } = readSubscriptionPeriod(subscription);
  return {
    currentPeriodStart: stripeSecondsToDate(start),
    currentPeriodEnd: stripeSecondsToDate(end),
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
  invoice: Stripe.Invoice & LegacyInvoiceFields,
): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (fromParent) return readStripeId(fromParent);
  return readStripeId(invoice.subscription);
}

/** Total tax an invoice carries, in minor units. */
export function readInvoiceTax(
  invoice: Stripe.Invoice & LegacyInvoiceFields,
): number {
  if (invoice.total_taxes) return sumAmounts(invoice.total_taxes);
  return invoice.tax ?? 0;
}

/**
 * The refund a credit note returned money through. dms-saas issues at most one
 * refund per credit note, so the first entry is the one to mirror.
 */
export function readCreditNoteRefundId(
  creditNote: Stripe.CreditNote & LegacyCreditNoteFields,
): string | null {
  const refund = creditNote.refunds?.[0]?.refund;
  if (refund) return readStripeId(refund);
  return readStripeId(creditNote.refund);
}

/** Tax carried by a credit note's lines, in minor units. */
export function readCreditNoteLineTax(
  creditNote: Stripe.CreditNote & LegacyCreditNoteFields,
): number {
  if (creditNote.total_taxes) return sumAmounts(creditNote.total_taxes);
  return sumAmounts(creditNote.tax_amounts);
}
