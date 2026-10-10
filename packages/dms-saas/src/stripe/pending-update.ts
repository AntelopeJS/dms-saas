import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { readInvoiceSubscriptionId, readStripeId } from "./payload-shapes";

const SUBSCRIPTION_UPDATE_REASON = "subscription_update";
const OPEN_STATUS = "open";
const LATEST_INVOICE_EXPANSION = "latest_invoice";
const PAYMENT_INTENT_EXPANSION = "payments.data.payment.payment_intent";
const REQUIRES_ACTION_STATUS = "requires_action";
/** A payment Stripe took, whose invoice it may still be marking paid. */
const TAKEN_PAYMENT_STATUSES = new Set<string>(["succeeded", "processing"]);

function invoicePaymentIntents(
  invoice: Stripe.Invoice,
): Stripe.PaymentIntent[] {
  return (invoice.payments?.data ?? [])
    .map((entry) => entry.payment.payment_intent)
    .filter(
      (intent): intent is Stripe.PaymentIntent =>
        !!intent && typeof intent === "object",
    );
}

/** The payments Stripe attempted for the invoice a pending update awaits. */
async function readPendingPayments(
  subscription: Stripe.Subscription,
): Promise<Stripe.PaymentIntent[]> {
  const invoiceId = readStripeId(subscription.latest_invoice);
  if (!invoiceId) return [];
  const invoice = await getStripeClient().invoices.retrieve(invoiceId, {
    expand: [PAYMENT_INTENT_EXPANSION],
  });
  return invoicePaymentIntents(invoice);
}

/** The client secret of the payment a pending update waits to authenticate. */
export async function readPendingChallengeSecret(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const payments = await readPendingPayments(subscription);
  const challenge = payments.find(
    (intent) => intent.status === REQUIRES_ACTION_STATUS,
  );
  return challenge?.client_secret ?? null;
}

/** Whether Stripe took the payment a pending update waits on. */
export async function isPendingPaymentTaken(
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const payments = await readPendingPayments(subscription);
  return payments.some((intent) => TAKEN_PAYMENT_STATUSES.has(intent.status));
}

/** Voiding its invoice is how Stripe drops a pending update. */
export async function discardPendingUpdate(
  subscription: Stripe.Subscription,
): Promise<void> {
  const invoiceId = readStripeId(subscription.latest_invoice);
  if (invoiceId) await getStripeClient().invoices.voidInvoice(invoiceId);
}

/**
 * Whether a failed payment belongs to a plan change Stripe holds as a pending
 * update, which is no debt: the change applies only once that invoice is paid
 * and is dropped with it otherwise. Its first attempt fails whenever the card
 * asks for 3D Secure, while the owner is still passing the challenge.
 */
export async function isPendingUpdatePayment(
  invoice: Stripe.Invoice,
): Promise<boolean> {
  if (invoice.billing_reason !== SUBSCRIPTION_UPDATE_REASON) return false;
  const subscriptionId = readInvoiceSubscriptionId(invoice);
  if (!subscriptionId || !invoice.id) return false;
  const subscription = await getStripeClient().subscriptions.retrieve(
    subscriptionId,
    { expand: [LATEST_INVOICE_EXPANSION] },
  );
  const latest = subscription.latest_invoice;
  if (readStripeId(latest) !== invoice.id) return false;
  // Paid or voided since: the update was applied or dropped either way.
  const isSettled =
    typeof latest === "object" && latest?.status !== OPEN_STATUS;
  return !!subscription.pending_update || isSettled;
}
