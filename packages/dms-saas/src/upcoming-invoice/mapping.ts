import type {
  AvailableUpcomingInvoicePreview,
  UpcomingInvoiceLine,
  UpcomingInvoiceLineKind,
  UpcomingInvoiceTax,
} from "@antelopejs/interface-dms-saas/billing";
import type Stripe from "stripe";
import { LINE_KEY_METADATA } from "../invoice-line-items";

const MS_PER_SECOND = 1000;
const REVERSE_CHARGE_REASON = "reverse_charge";
const SUBSCRIPTION_LINE_TYPE = "subscription";

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

function toLineKind(line: Stripe.InvoiceLineItem): UpcomingInvoiceLineKind {
  if (line.type === SUBSCRIPTION_LINE_TYPE) return "subscription";
  return line.metadata?.[LINE_KEY_METADATA] ? "usage" : "invoice_item";
}

function toPreviewLine(line: Stripe.InvoiceLineItem): UpcomingInvoiceLine {
  return {
    kind: toLineKind(line),
    description: line.description,
    amountMinorUnits: line.amount_excluding_tax ?? line.amount,
    taxMinorUnits: sumAmounts(line.tax_amounts),
    quantity: line.quantity,
    periodStart: toIsoDate(line.period.start),
    periodEnd: toIsoDate(line.period.end),
    isProration: line.proration,
    usageLineKey: line.metadata?.[LINE_KEY_METADATA] ?? null,
  };
}

function toUppercase(value: string | null | undefined): string | null {
  return value ? value.toUpperCase() : null;
}

function expandedTaxRate(
  taxRate: string | Stripe.TaxRate,
): Stripe.TaxRate | null {
  return typeof taxRate === "string" ? null : taxRate;
}

function toPreviewTax(
  taxAmount: Stripe.Invoice.TotalTaxAmount,
): UpcomingInvoiceTax {
  const rate = expandedTaxRate(taxAmount.tax_rate);
  return {
    amountMinorUnits: taxAmount.amount,
    taxableAmountMinorUnits: taxAmount.taxable_amount,
    isInclusive: taxAmount.inclusive,
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
  invoice: Stripe.Invoice,
  pricing: PreviewPricingContext,
): AvailableUpcomingInvoicePreview {
  const taxes = (invoice.total_tax_amounts ?? []).map(toPreviewTax);
  const taxMinorUnits = sumAmounts(invoice.total_tax_amounts);
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
