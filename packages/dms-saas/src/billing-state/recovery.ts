import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  type Invoice,
  InvoiceModel,
  type TenantSubscription,
} from "../db";
import { getStripeClient } from "../stripe/client";
import { MS_PER_DAY, stripeSecondsToDate } from "../utils/time";

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface UnpaidInvoiceRef {
  number: string | null;
  amount: number;
  currency: string;
  hostedInvoiceUrl: string | null;
}

export interface UnpaidInvoiceSummary extends UnpaidInvoiceRef {
  failedAt: Date | null;
  nextRetryAt: Date | null;
  suspendAt: Date | null;
}

function toCardSummary(
  paymentMethod: Stripe.PaymentMethod | null,
): PaymentMethodSummary | null {
  const card = paymentMethod?.card;
  if (!card) return null;
  return {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  };
}

/**
 * Read-only view of the customer's default card. Brand, last four digits and
 * expiry are the only fields that ever leave Stripe, so nothing here is PCI
 * scoped and card changes still happen in the Stripe portal.
 */
export async function fetchDefaultPaymentMethod(
  stripeCustomerId: string,
): Promise<PaymentMethodSummary | null> {
  const stripe = getStripeClient();
  const customer = await stripe.customers
    .retrieve(stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    })
    .catch(() => null);
  if (!customer || customer.deleted) return null;
  const defaultMethod = customer.invoice_settings?.default_payment_method;
  if (!defaultMethod || typeof defaultMethod === "string") return null;
  return toCardSummary(defaultMethod);
}

async function resolveSuspendAt(
  pastDueSince: Date | null,
): Promise<Date | null> {
  if (!pastDueSince) return null;
  const billingSettingsModel = GetModel(BillingSettingsModel);
  const settings = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  if (!settings?.autoSuspendEnabled) return null;
  const delayDays =
    settings.autoSuspendDelayDays ?? DEFAULT_AUTO_SUSPEND_DELAY_DAYS;
  return new Date(pastDueSince.getTime() + delayDays * MS_PER_DAY);
}

async function fetchNextRetryAt(stripeInvoiceId: string): Promise<Date | null> {
  const stripe = getStripeClient();
  const invoice = await stripe.invoices
    .retrieve(stripeInvoiceId)
    .catch(() => null);
  return stripeSecondsToDate(invoice?.next_payment_attempt);
}

export function toUnpaidInvoiceRef(invoice: Invoice): UnpaidInvoiceRef {
  return {
    number: invoice.number,
    // `total` is only mirrored from the invoice's next Stripe event, so older
    // rows fall back to the amount captured when they were first stored.
    amount: invoice.total || invoice.amount,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
  };
}

/**
 * What is owed and where to pay it, straight from the invoice mirror. Used by
 * the access gate's own endpoint, so it stays free of Stripe round-trips.
 */
export async function buildUnpaidInvoiceRef(
  tenantId: string,
): Promise<UnpaidInvoiceRef | null> {
  const invoice = await GetModel(InvoiceModel, tenantId).findLatestOpen();
  return invoice ? toUnpaidInvoiceRef(invoice) : null;
}

/**
 * Everything the past-due banner needs to be actionable: what is owed, when the
 * charge failed, when Stripe retries, and the deadline before auto-suspension.
 */
export async function buildUnpaidInvoiceSummary(
  tenantId: string,
  subscription: TenantSubscription,
): Promise<UnpaidInvoiceSummary | null> {
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const invoice = await invoiceModel.findLatestOpen();
  if (!invoice) return null;
  const [nextRetryAt, suspendAt] = await Promise.all([
    fetchNextRetryAt(invoice.stripeInvoiceId),
    resolveSuspendAt(subscription.pastDueSince ?? null),
  ]);
  return {
    ...toUnpaidInvoiceRef(invoice),
    failedAt: subscription.pastDueSince ?? null,
    nextRetryAt,
    suspendAt,
  };
}
