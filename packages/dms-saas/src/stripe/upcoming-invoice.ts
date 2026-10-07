import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { readSubscriptionPeriod } from "./payload-shapes";

const MS_PER_SECOND = 1000;

/** The billing cycle a Stripe subscription is currently in. */
export interface StripeSubscriptionCycle {
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * A preview invoice with the tax rates its taxes reference. Since basil an
 * invoice's taxes carry only the rate id, so the rates are fetched alongside.
 */
export interface PricedUpcomingInvoice {
  invoice: Stripe.Invoice;
  taxRates: Map<string, Stripe.TaxRate>;
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
  const period = readSubscriptionPeriod(subscription);
  if (period.start === null || period.end === null)
    throw new Error(
      `Stripe subscription ${subscriptionId} has no billing period`,
    );
  return {
    currency: subscription.currency,
    currentPeriodStart: fromStripeSeconds(period.start),
    currentPeriodEnd: fromStripeSeconds(period.end),
  };
}

function collectTaxRateIds(invoice: Stripe.Invoice): string[] {
  const ids = (invoice.total_taxes ?? [])
    .map((tax) => tax.tax_rate_details?.tax_rate)
    .filter((id): id is string => typeof id === "string");
  return [...new Set(ids)];
}

async function retrieveTaxRates(
  ids: string[],
): Promise<Map<string, Stripe.TaxRate>> {
  const stripe = getStripeClient();
  const rates = await Promise.all(
    ids.map((id) => stripe.taxRates.retrieve(id)),
  );
  return new Map(rates.map((rate) => [rate.id, rate]));
}

/**
 * Ask Stripe to price an invoice that does not exist yet (a renewal, a plan
 * change, a first subscription), with the tax rates its taxes reference so
 * the country, type and percentage of each tax are known.
 */
export async function previewStripeInvoice(
  params: Stripe.InvoiceCreatePreviewParams,
): Promise<PricedUpcomingInvoice> {
  const invoice = await getStripeClient().invoices.createPreview(params);
  const taxRates = await retrieveTaxRates(collectTaxRateIds(invoice));
  return { invoice, taxRates };
}

/**
 * Ask Stripe to price the subscription's next invoice, quoted items included,
 * with the tax settings the subscription itself carries.
 */
export async function previewStripeUpcomingInvoice(
  request: UpcomingInvoicePreviewRequest,
): Promise<PricedUpcomingInvoice> {
  return previewStripeInvoice({
    customer: request.customerId,
    subscription: request.subscriptionId,
    invoice_items: request.quotedItems.map((item) =>
      toPreviewInvoiceItem(request.currency, item),
    ),
  });
}

/** A subscription moved to another price, as a preview asks it. */
export interface PriceChangePreviewRequest {
  customerId: string;
  subscriptionId: string;
  itemId: string;
  priceId: string;
  /** The moment the proration is computed at, shared with the change itself. */
  prorationDate: Date;
}

/**
 * Ask Stripe what moving the subscription to another price bills, prorated
 * the way the immediate plan change prorates it. When the interval changes,
 * Stripe resets the cycle and the preview is the invoice issued at once;
 * otherwise it is the next invoice, prorations included.
 */
export async function previewStripePriceChange(
  request: PriceChangePreviewRequest,
): Promise<PricedUpcomingInvoice> {
  const invoice = await getStripeClient().invoices.createPreview({
    customer: request.customerId,
    subscription: request.subscriptionId,
    subscription_details: {
      items: [{ id: request.itemId, price: request.priceId }],
      proration_behavior: "create_prorations",
      proration_date: toStripeSeconds(request.prorationDate),
    },
  });
  const taxRates = await retrieveTaxRates(collectTaxRateIds(invoice));
  return { invoice, taxRates };
}
