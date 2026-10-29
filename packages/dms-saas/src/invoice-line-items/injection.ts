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
import { normalizeInvoiceLineItemsResolution } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getStripeClient } from "../stripe/client";
import {
  readInvoiceSubscriptionId,
  requireInvoiceId,
} from "../stripe/payload-shapes";
import { TenantSubscriptionModel } from "../db";
import { clipInvoiceUsageWindow } from "./billing-window";

/** Stripe metadata key carrying the `<provider id>:<key>` of a usage line. */
export const LINE_KEY_METADATA = "saasLineKey";
/** Stripe metadata key carrying the provider id of a usage line. */
export const LINE_PROVIDER_METADATA = "saasLineProvider";
const LINE_QUANTITY_METADATA = "saasLineQuantity";
const LINE_UNIT_METADATA = "saasLineUnit";
const IDEMPOTENCY_KEY_PREFIX = "saas-invoice-line";
const CYCLE_RENEWAL_BILLING_REASON = "subscription_cycle";
const DRAFT_INVOICE_STATUS = "draft";
const CREATE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const MS_PER_SECOND = 1000;
const LOG_PREFIX = "[dms-saas:invoice-line-items]";

const REPORTED_SKIP_REASONS = new Set<SkippedLineItemReason>([
  "invalid",
  "duplicate_key",
]);

export interface InvoiceInjectionTarget {
  customerId: string;
  context: InvoiceLineItemsContext;
}

interface ProviderResolution {
  lineItems: InvoiceLineItem[];
  failures: number;
}

/** A cycle renewal draft: the only invoice usage lines are injected into. */
export function canInjectIntoInvoice(invoice: Stripe.Invoice): boolean {
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

/** The clipped paid-usage window of an invoice, or null when nothing is billable. */
export async function buildInjectionTarget(
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
      invoiceId: requireInvoiceId(invoice),
      currency: invoice.currency,
      periodStart: stripeSecondsToDate(invoice.period_start),
      periodEnd: stripeSecondsToDate(invoice.period_end),
    },
    subscription,
    readInvoiceSubscriptionId(invoice),
  );
  return context ? { customerId, context } : null;
}

/**
 * Run one provider for a quote, turning a throw — or an answer other than
 * `ready`, which a quote cannot wait for — into a logged failure count.
 */
export async function resolveProviderLineItems(
  provider: InvoiceLineItemsProvider,
  context: InvoiceLineItemsContext,
): Promise<ProviderResolution> {
  try {
    const resolution = normalizeInvoiceLineItemsResolution(
      await provider.resolve(context),
    );
    if (resolution.status === "ready")
      return { lineItems: resolution.lines, failures: 0 };
    Logging.Info(
      `${LOG_PREFIX} provider '${provider.id}' is ${resolution.status} on invoice ${context.invoiceId}: ${resolution.reason}`,
    );
    return { lineItems: [], failures: 1 };
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
): Stripe.Metadata {
  const metadata: Stripe.Metadata = {
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

/** Create one managed line on a draft, idempotent per invoice and line key. */
export async function createInvoiceLineItemWithRetries(
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
