import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  InvoiceLineItem,
  InvoiceLineItemsContext,
  InvoiceLineItemsProvider,
  PreparedInvoiceLineItem,
  SkippedInvoiceLineItem,
  SkippedLineItemReason,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { selectInvoiceLineItemsToCreate } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getInvoiceLineItemsProviders } from "../implementations/dms-saas/invoice-line-items";
import { getStripeClient } from "../stripe/client";
import { TenantSubscriptionModel } from "../db";
import { clipInvoiceUsageWindow } from "./billing-window";

/** Stripe metadata key carrying the `<provider id>:<key>` of a usage line. */
export const LINE_KEY_METADATA = "saasLineKey";
const LINE_PROVIDER_METADATA = "saasLineProvider";
const LINE_QUANTITY_METADATA = "saasLineQuantity";
const LINE_UNIT_METADATA = "saasLineUnit";
const IDEMPOTENCY_KEY_PREFIX = "saas-invoice-line";
const CYCLE_RENEWAL_BILLING_REASON = "subscription_cycle";
const DRAFT_INVOICE_STATUS = "draft";
const INVOICE_ITEMS_PAGE_SIZE = 100;
const INVOICE_ITEMS_HARD_CAP = 250;
const CREATE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const MS_PER_SECOND = 1000;
const LOG_PREFIX = "[dms-saas:invoice-line-items]";

const REPORTED_SKIP_REASONS = new Set<SkippedLineItemReason>([
  "invalid",
  "duplicate_key",
]);

interface InvoiceInjectionTarget {
  customerId: string;
  context: InvoiceLineItemsContext;
}

interface ProviderResolution {
  lineItems: InvoiceLineItem[];
  failures: number;
}

function canInjectIntoInvoice(invoice: Stripe.Invoice): boolean {
  if (invoice.billing_reason !== CYCLE_RENEWAL_BILLING_REASON) return false;
  if (invoice.status === DRAFT_INVOICE_STATUS) return true;
  Logging.Warn(
    `${LOG_PREFIX} invoice ${invoice.id} was already '${invoice.status}' when the event was handled: this cycle's usage lines can no longer be added and will not be billed`,
  );
  return false;
}

function stripeSecondsToDate(seconds: number): Date {
  return new Date(seconds * MS_PER_SECOND);
}

function toStripeSeconds(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_SECOND);
}

async function buildInjectionTarget(
  invoice: Stripe.Invoice,
  tenantId: string,
  customerId: string,
): Promise<InvoiceInjectionTarget | null> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  const context = clipInvoiceUsageWindow(
    {
      tenantId,
      invoiceId: invoice.id,
      currency: invoice.currency,
      periodStart: stripeSecondsToDate(invoice.period_start),
      periodEnd: stripeSecondsToDate(invoice.period_end),
    },
    subscription,
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : (invoice.subscription?.id ?? null),
  );
  return context ? { customerId, context } : null;
}

async function fetchInjectedLineKeys(invoiceId: string): Promise<Set<string>> {
  const stripe = getStripeClient();
  const items = await stripe.invoiceItems
    .list({ invoice: invoiceId, limit: INVOICE_ITEMS_PAGE_SIZE })
    .autoPagingToArray({ limit: INVOICE_ITEMS_HARD_CAP });
  const keys = items
    .map((item) => item.metadata?.[LINE_KEY_METADATA])
    .filter((key): key is string => typeof key === "string");
  return new Set(keys);
}

/** Run one provider, turning a throw into a logged failure count. */
export async function resolveProviderLineItems(
  provider: InvoiceLineItemsProvider,
  context: InvoiceLineItemsContext,
): Promise<ProviderResolution> {
  try {
    const lineItems = await provider.resolve(context);
    return {
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      failures: 0,
    };
  } catch (error) {
    Logging.Error(
      `${LOG_PREFIX} provider '${provider.id}' failed on invoice ${context.invoiceId}`,
      error,
    );
    return { lineItems: [], failures: 1 };
  }
}

export function reportSkippedLineItems(
  providerId: string,
  invoiceId: string,
  skipped: SkippedInvoiceLineItem[],
): void {
  for (const line of skipped) {
    if (!REPORTED_SKIP_REASONS.has(line.reason)) continue;
    Logging.Warn(
      `${LOG_PREFIX} provider '${providerId}' returned an unusable line '${line.lineKey}' on invoice ${invoiceId} (${line.reason})`,
    );
  }
}

export function buildLineItemMetadata(
  providerId: string,
  prepared: PreparedInvoiceLineItem,
): Record<string, string> {
  const metadata: Record<string, string> = {
    ...prepared.item.metadata,
  };
  if (prepared.item.quantity !== undefined) {
    metadata[LINE_QUANTITY_METADATA] = String(prepared.item.quantity);
  }
  if (prepared.item.unit !== undefined) {
    metadata[LINE_UNIT_METADATA] = prepared.item.unit;
  }
  metadata[LINE_PROVIDER_METADATA] = providerId;
  metadata[LINE_KEY_METADATA] = prepared.lineKey;
  return metadata;
}

async function createInvoiceLineItem(
  providerId: string,
  target: InvoiceInjectionTarget,
  prepared: PreparedInvoiceLineItem,
): Promise<void> {
  const { context } = target;
  const stripe = getStripeClient();
  await stripe.invoiceItems.create(
    {
      customer: target.customerId,
      invoice: context.invoiceId,
      currency: context.currency,
      amount: prepared.item.amountCents,
      description: prepared.item.description,
      period: {
        start: toStripeSeconds(context.periodStart),
        end: toStripeSeconds(context.periodEnd),
      },
      metadata: buildLineItemMetadata(providerId, prepared),
    },
    {
      idempotencyKey: `${IDEMPOTENCY_KEY_PREFIX}:${context.invoiceId}:${prepared.lineKey}`,
    },
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createInvoiceLineItemWithRetries(
  providerId: string,
  target: InvoiceInjectionTarget,
  prepared: PreparedInvoiceLineItem,
): Promise<void> {
  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
    try {
      await createInvoiceLineItem(providerId, target, prepared);
      return;
    } catch (error) {
      if (attempt === CREATE_ATTEMPTS) throw error;
      Logging.Warn(
        `${LOG_PREFIX} retrying line '${prepared.lineKey}' on invoice ${target.context.invoiceId}`,
        error,
      );
      await delay(RETRY_DELAY_MS);
    }
  }
}

async function injectProviderLineItems(
  provider: InvoiceLineItemsProvider,
  target: InvoiceInjectionTarget,
  injectedKeys: Set<string>,
): Promise<number> {
  const { context } = target;
  const resolution = await resolveProviderLineItems(provider, context);
  const selection = selectInvoiceLineItemsToCreate(
    provider.id,
    resolution.lineItems,
    injectedKeys,
  );
  reportSkippedLineItems(provider.id, context.invoiceId, selection.skipped);
  // A structurally unusable line is usage that will never be billed — a
  // float-cents bug would otherwise underbill every cycle behind a green
  // webhook. It counts as a failure so the event surfaces it; duplicates and
  // zero amounts stay silent drops, as the contract documents.
  const invalidLines = selection.skipped.filter(
    (line) => line.reason === "invalid",
  ).length;
  let failures = resolution.failures + invalidLines;
  for (const prepared of selection.accepted) {
    try {
      await createInvoiceLineItemWithRetries(provider.id, target, prepared);
      injectedKeys.add(prepared.lineKey);
    } catch (error) {
      failures += 1;
      Logging.Error(
        `${LOG_PREFIX} could not invoice line '${prepared.lineKey}' on invoice ${context.invoiceId}`,
        error,
      );
    }
  }
  return failures;
}

/**
 * Push the registered providers' lines onto a Stripe cycle renewal invoice
 * while it is still a draft, so they are billed on finalization.
 *
 * Runs only on `subscription_cycle` draft invoices: the first invoice of a
 * subscription and one-off invoices carry no closed usage period.
 *
 * Throws once every provider and every line has been attempted, so a partial
 * injection surfaces on the webhook event rather than silently underbilling
 * the cycle. The caller has already mirrored the invoice by then, and every
 * line is idempotent, so Stripe's redelivery cannot double-charge.
 */
export async function injectProvidedInvoiceLineItems(
  invoice: Stripe.Invoice,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const providers = getInvoiceLineItemsProviders();
  if (providers.length === 0) return;
  if (!canInjectIntoInvoice(invoice)) return;
  const target = await buildInjectionTarget(invoice, tenantId, customerId);
  if (!target) return;
  const injectedKeys = await fetchInjectedLineKeys(target.context.invoiceId);
  let failures = 0;
  for (const provider of providers) {
    failures += await injectProviderLineItems(provider, target, injectedKeys);
  }
  if (failures > 0) {
    throw new Error(
      `${failures} usage line(s) could not be invoiced on ${target.context.invoiceId}`,
    );
  }
}
