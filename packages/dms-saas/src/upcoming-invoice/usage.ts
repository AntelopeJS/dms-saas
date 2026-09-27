import type {
  InvoiceLineItemsContext,
  InvoiceLineItemsProvider,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { selectInvoiceLineItemsToCreate } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type { TenantSubscription } from "../db";
import { getInvoiceLineItemsProviders } from "../implementations/dms-saas/invoice-line-items";
import {
  buildLineItemMetadata,
  reportSkippedLineItems,
  resolveProviderLineItems,
} from "../invoice-line-items";
import { clipInvoiceUsageWindow } from "../invoice-line-items/billing-window";
import type {
  QuotedInvoiceItem,
  StripeSubscriptionCycle,
} from "../stripe/upcoming-invoice";

const PREVIEW_INVOICE_ID_PREFIX = "upcoming_";

/** Usage lines quoted on a preview and the time they run up to. */
export interface QuotedUsage {
  items: QuotedInvoiceItem[];
  usageThrough: Date | null;
}

/** Where the usage of the running cycle is quoted from. */
export interface UsageQuoteRequest {
  tenantId: string;
  subscription: TenantSubscription;
  stripeSubscriptionId: string;
  cycle: StripeSubscriptionCycle;
  now: Date;
}

const NO_USAGE: QuotedUsage = { items: [], usageThrough: null };

function buildPreviewContext(
  request: UsageQuoteRequest,
): InvoiceLineItemsContext | null {
  if (request.now <= request.cycle.currentPeriodStart) return null;
  return clipInvoiceUsageWindow(
    {
      tenantId: request.tenantId,
      invoiceId: `${PREVIEW_INVOICE_ID_PREFIX}${request.stripeSubscriptionId}`,
      currency: request.cycle.currency,
      periodStart: request.cycle.currentPeriodStart,
      periodEnd: request.now,
      isPreview: true,
    },
    request.subscription,
    request.stripeSubscriptionId,
  );
}

async function quoteProviderLines(
  provider: InvoiceLineItemsProvider,
  context: InvoiceLineItemsContext,
): Promise<QuotedInvoiceItem[] | null> {
  const resolution = await resolveProviderLineItems(provider, context);
  if (resolution.failures > 0) return null;
  const selection = selectInvoiceLineItemsToCreate(
    provider.id,
    resolution.lineItems,
    new Set(),
  );
  reportSkippedLineItems(provider.id, context.invoiceId, selection.skipped);
  if (selection.skipped.some((line) => line.reason === "invalid")) return null;
  return selection.accepted.map((prepared) => ({
    amountMinorUnits: prepared.item.amountCents,
    description: prepared.item.description,
    periodStart: context.periodStart,
    periodEnd: context.periodEnd,
    metadata: buildLineItemMetadata(provider.id, prepared),
  }));
}

/**
 * Quote the running cycle's usage, up to now, the way the renewal invoice will
 * bill it: same providers, same paid-coverage window, same line validation.
 * A provider that fails or returns an unusable line voids the whole quote —
 * a total silently missing part of the usage would not be exact.
 */
export async function quoteRunningCycleUsage(
  request: UsageQuoteRequest,
): Promise<QuotedUsage | null> {
  const providers = getInvoiceLineItemsProviders();
  if (providers.length === 0) return NO_USAGE;
  const context = buildPreviewContext(request);
  if (!context) return NO_USAGE;
  const quotes = await Promise.all(
    providers.map((provider) => quoteProviderLines(provider, context)),
  );
  if (quotes.some((quote) => quote === null)) return null;
  return {
    items: quotes.flatMap((quote) => quote ?? []),
    usageThrough: context.periodEnd,
  };
}
