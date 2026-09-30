import type {
  AvailableUpcomingInvoicePreview,
  UpcomingInvoiceLine,
  UpcomingInvoiceLineKind,
  UpcomingInvoiceTax,
} from "@antelopejs/interface-dms-saas/billing";
import type Stripe from "stripe";
import { LINE_KEY_METADATA } from "../invoice-line-items";
import type { PricedUpcomingInvoice } from "../stripe/upcoming-invoice";

const MS_PER_SECOND = 1000;
const REVERSE_CHARGE_REASON = "reverse_charge";
const INCLUSIVE_TAX_BEHAVIOR = "inclusive";

/** What the preview was priced against, beyond the Stripe invoice itself. */
export interface PreviewPricingContext {
  billingDate: Date;
  usageThrough: Date | null;
  computedAt: Date;
}

interface TaxedAmount {
  amount: number;
}

function toIsoDate(seconds: number): string {
  return new Date(seconds * MS_PER_SECOND).toISOString();
}

function sumAmounts(amounts: TaxedAmount[] | null | undefined): number {
  return (amounts ?? []).reduce((total, entry) => total + entry.amount, 0);
}

/**
 * A subscription item's recurring charge. A proration of that item carries the
 * invoice item it was booked as, which is what tells the two apart since basil.
 */
function isRecurringSubscriptionLine(line: Stripe.InvoiceLineItem): boolean {
  const details = line.parent?.subscription_item_details;
  return !!details && !details.invoice_item;
}

function toLineKind(line: Stripe.InvoiceLineItem): UpcomingInvoiceLineKind {
  if (isRecurringSubscriptionLine(line)) return "subscription";
  return line.metadata?.[LINE_KEY_METADATA] ? "usage" : "invoice_item";
}

function isProrationLine(line: Stripe.InvoiceLineItem): boolean {
  const parent = line.parent;
  return !!(
    parent?.subscription_item_details?.proration ||
    parent?.invoice_item_details?.proration
  );
}

/** A line amount includes its inclusive taxes; the preview shows it without. */
function amountExcludingTax(line: Stripe.InvoiceLineItem): number {
  const inclusiveTaxes = (line.taxes ?? []).filter(
    (tax) => tax.tax_behavior === INCLUSIVE_TAX_BEHAVIOR,
  );
  return line.amount - sumAmounts(inclusiveTaxes);
}

function toPreviewLine(line: Stripe.InvoiceLineItem): UpcomingInvoiceLine {
  return {
    kind: toLineKind(line),
    description: line.description,
    amountMinorUnits: amountExcludingTax(line),
    taxMinorUnits: sumAmounts(line.taxes),
    quantity: line.quantity,
    periodStart: toIsoDate(line.period.start),
    periodEnd: toIsoDate(line.period.end),
    isProration: isProrationLine(line),
    usageLineKey: line.metadata?.[LINE_KEY_METADATA] ?? null,
  };
}

function toUppercase(value: string | null | undefined): string | null {
  return value ? value.toUpperCase() : null;
}

function toPreviewTax(
  taxAmount: Stripe.Invoice.TotalTax,
  taxRates: Map<string, Stripe.TaxRate>,
): UpcomingInvoiceTax {
  const rateId = taxAmount.tax_rate_details?.tax_rate;
  const rate = rateId ? (taxRates.get(rateId) ?? null) : null;
  return {
    amountMinorUnits: taxAmount.amount,
    taxableAmountMinorUnits: taxAmount.taxable_amount,
    isInclusive: taxAmount.tax_behavior === INCLUSIVE_TAX_BEHAVIOR,
    ratePercentage: rate
      ? (rate.effective_percentage ?? rate.percentage)
      : null,
    country: toUppercase(rate?.country),
    taxType: rate?.tax_type ?? null,
    displayName: rate?.display_name ?? null,
    jurisdiction: rate?.jurisdiction ?? null,
    taxabilityReason: taxAmount.taxability_reason,
    isReverseCharge: taxAmount.taxability_reason === REVERSE_CHARGE_REASON,
  };
}

function resolveTaxCountry(
  invoice: Stripe.Invoice,
  taxes: UpcomingInvoiceTax[],
): string | null {
  const taxedCountry = taxes.find((tax) => tax.country)?.country;
  return taxedCountry ?? toUppercase(invoice.customer_address?.country);
}

/**
 * Project a Stripe preview invoice onto the consumer contract. Amounts are
 * copied from Stripe as they are — never recomputed — so the figures shown are
 * the ones Stripe will bill.
 */
export function toAvailablePreview(
  { invoice, taxRates }: PricedUpcomingInvoice,
  pricing: PreviewPricingContext,
): AvailableUpcomingInvoicePreview {
  const taxes = (invoice.total_taxes ?? []).map((tax) =>
    toPreviewTax(tax, taxRates),
  );
  const taxMinorUnits = sumAmounts(invoice.total_taxes);
  return {
    status: "available",
    currency: invoice.currency.toUpperCase(),
    lines: invoice.lines.data.map(toPreviewLine),
    hasMoreLines: invoice.lines.has_more,
    subtotalMinorUnits: invoice.subtotal_excluding_tax ?? invoice.subtotal,
    totalExcludingTaxMinorUnits:
      invoice.total_excluding_tax ?? invoice.total - taxMinorUnits,
    taxMinorUnits,
    taxes,
    taxCountry: resolveTaxCountry(invoice, taxes),
    isReverseCharge: taxes.some((tax) => tax.isReverseCharge),
    totalMinorUnits: invoice.total,
    amountDueMinorUnits: invoice.amount_due,
    periodStart: toIsoDate(invoice.period_start),
    periodEnd: toIsoDate(invoice.period_end),
    billingDate: pricing.billingDate.toISOString(),
    usageThrough: pricing.usageThrough?.toISOString() ?? null,
    computedAt: pricing.computedAt.toISOString(),
  };
}
