import { Logging } from "@antelopejs/interface-core/logging";
import type {
  UpcomingInvoicePreview,
  UpcomingInvoicePreviewUnavailableReason,
} from "@antelopejs/interface-dms-saas/billing";
import type Stripe from "stripe";
import {
  previewStripeUpcomingInvoice,
  retrieveStripeSubscriptionCycle,
} from "../stripe/upcoming-invoice";
import type { PreviewableSubscription } from "./eligibility";
import { toAvailablePreview } from "./mapping";
import {
  absent,
  type PreviewOutcome,
  stampOutcome,
  unavailable,
} from "./outcomes";
import { quoteRunningCycleUsage } from "./usage";

const LOG_PREFIX = "[dms-saas:upcoming-invoice]";
const COMPLETE_TAX_STATUS = "complete";

/** Stripe error codes that name why no exact preview can be given. */
const STRIPE_ERROR_OUTCOMES = new Map<string, PreviewOutcome>([
  ["invoice_upcoming_none", absent("no_upcoming_invoice")],
  ["stripe_tax_inactive", unavailable("tax_not_configured")],
  ["customer_tax_location_invalid", unavailable("tax_location_invalid")],
  ["invalid_tax_location", unavailable("tax_location_invalid")],
  ["taxes_calculation_failed", unavailable("tax_calculation_failed")],
]);

const AUTOMATIC_TAX_STATUS_REASONS: Record<
  string,
  UpcomingInvoicePreviewUnavailableReason
> = {
  requires_location_inputs: "tax_location_required",
  failed: "tax_calculation_failed",
};

const PROVIDER_ERROR = unavailable("provider_error");

interface CodedError {
  code?: unknown;
}

function stripeErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code } = error as CodedError;
  return typeof code === "string" ? code : null;
}

function classifyStripeError(error: unknown): PreviewOutcome {
  const code = stripeErrorCode(error);
  return (code && STRIPE_ERROR_OUTCOMES.get(code)) || PROVIDER_ERROR;
}

/**
 * A preview whose automatic tax did not complete carries no tax at all: its
 * total would read as tax-free when Stripe simply could not compute the tax.
 */
function incompleteTaxReason(
  invoice: Stripe.Invoice,
): UpcomingInvoicePreviewUnavailableReason | null {
  const { enabled, status } = invoice.automatic_tax;
  if (!enabled || status === COMPLETE_TAX_STATUS) return null;
  return (
    (status && AUTOMATIC_TAX_STATUS_REASONS[status]) || "tax_calculation_failed"
  );
}

function reportUnavailable(
  tenantId: string,
  reason: UpcomingInvoicePreviewUnavailableReason,
  cause?: unknown,
): void {
  Logging.Error(
    `${LOG_PREFIX} no upcoming invoice preview for tenant ${tenantId} (${reason})`,
    cause,
  );
}

async function priceWithStripe(
  tenantId: string,
  target: PreviewableSubscription,
  computedAt: Date,
): Promise<UpcomingInvoicePreview> {
  const cycle = await retrieveStripeSubscriptionCycle(target.subscriptionId);
  const usage = await quoteRunningCycleUsage({
    tenantId,
    subscription: target.subscription,
    stripeSubscriptionId: target.subscriptionId,
    cycle,
    now: computedAt,
  });
  if (!usage) {
    reportUnavailable(tenantId, "usage_unavailable");
    return stampOutcome(unavailable("usage_unavailable"), computedAt);
  }
  const invoice = await previewStripeUpcomingInvoice({
    customerId: target.customerId,
    subscriptionId: target.subscriptionId,
    currency: cycle.currency,
    quotedItems: usage.items,
  });
  const taxReason = incompleteTaxReason(invoice);
  if (taxReason) {
    reportUnavailable(tenantId, taxReason);
    return stampOutcome(unavailable(taxReason), computedAt);
  }
  return toAvailablePreview(invoice, {
    billingDate: cycle.currentPeriodEnd,
    usageThrough: usage.usageThrough,
    computedAt,
  });
}

/**
 * Price the next invoice with Stripe. Never throws: a Stripe failure resolves
 * to a typed outcome and is logged, so no caller breaks on a provider outage.
 */
export async function priceUpcomingInvoice(
  tenantId: string,
  target: PreviewableSubscription,
  computedAt: Date,
): Promise<UpcomingInvoicePreview> {
  try {
    return await priceWithStripe(tenantId, target, computedAt);
  } catch (error) {
    const outcome = classifyStripeError(error);
    if (outcome.status === "unavailable") {
      reportUnavailable(tenantId, outcome.reason, error);
    }
    return stampOutcome(outcome, computedAt);
  }
}
