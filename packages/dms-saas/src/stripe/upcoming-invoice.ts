import type Stripe from "stripe";
import { getStripeClient } from "./client";

const MS_PER_SECOND = 1000;
const TAX_RATE_EXPANSION = "total_tax_amounts.tax_rate";

/** The billing cycle a Stripe subscription is currently in. */
export interface StripeSubscriptionCycle {
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/** A hypothetical invoice item priced on a preview and never created. */
export interface QuotedInvoiceItem {
  amountMinorUnits: number;
  description: string;
  periodStart: Date;
  periodEnd: Date;
  metadata: Record<string, string>;
}

/** What the upcoming invoice of a subscription is previewed with. */
export interface UpcomingInvoicePreviewRequest {
  customerId: string;
  subscriptionId: string;
  currency: string;
  quotedItems: QuotedInvoiceItem[];
}

function toStripeSeconds(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_SECOND);
}

function fromStripeSeconds(seconds: number): Date {
  return new Date(seconds * MS_PER_SECOND);
}

function toPreviewInvoiceItem(
  currency: string,
  item: QuotedInvoiceItem,
): Stripe.InvoiceCreatePreviewParams.InvoiceItem {
  return {
    amount: item.amountMinorUnits,
    currency,
    description: item.description,
    period: {
      start: toStripeSeconds(item.periodStart),
      end: toStripeSeconds(item.periodEnd),
    },
    metadata: item.metadata,
  };
}

/** Read the current cycle of a subscription directly from Stripe. */
export async function retrieveStripeSubscriptionCycle(
  subscriptionId: string,
): Promise<StripeSubscriptionCycle> {
  const subscription =
    await getStripeClient().subscriptions.retrieve(subscriptionId);
  return {
    currency: subscription.currency,
    currentPeriodStart: fromStripeSeconds(subscription.current_period_start),
    currentPeriodEnd: fromStripeSeconds(subscription.current_period_end),
  };
}

/**
 * Ask Stripe to price the subscription's next invoice, quoted items included,
 * with the tax settings the subscription itself carries. Tax rates are
 * expanded so the country, type and percentage of each tax come with it.
 */
export async function previewStripeUpcomingInvoice(
  request: UpcomingInvoicePreviewRequest,
): Promise<Stripe.Invoice> {
  return getStripeClient().invoices.createPreview({
    customer: request.customerId,
    subscription: request.subscriptionId,
    invoice_items: request.quotedItems.map((item) =>
      toPreviewInvoiceItem(request.currency, item),
    ),
    expand: [TAX_RATE_EXPANSION],
  });
}
