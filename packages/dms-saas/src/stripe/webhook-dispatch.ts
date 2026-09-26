import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { StripeWebhookEventModel } from "../db";
import { invalidatePreviewForStripeEvent } from "../upcoming-invoice/invalidation";
import {
  handleChargeRefundUpdated,
  handleCustomerUpdated,
  handleInvoiceCreated,
  handleInvoiceFinalized,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleInvoiceVoided,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
  handleTrialWillEnd,
} from "./webhook-handlers";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
} from "./webhook-checkout";
import {
  handleCreditNoteCreated,
  handleCreditNoteVoided,
} from "./webhook-credit-notes";

type WebhookHandler = (event: Stripe.Event) => Promise<void>;

const HANDLERS: Record<string, WebhookHandler> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "checkout.session.expired": handleCheckoutSessionExpired,
  "invoice.created": handleInvoiceCreated,
  "invoice.finalized": handleInvoiceFinalized,
  "invoice.paid": handleInvoicePaid,
  "invoice.voided": handleInvoiceVoided,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "credit_note.created": handleCreditNoteCreated,
  "credit_note.voided": handleCreditNoteVoided,
  "charge.refund.updated": handleChargeRefundUpdated,
  "customer.updated": handleCustomerUpdated,
  "customer.subscription.deleted": handleSubscriptionDeleted,
  "customer.subscription.trial_will_end": handleTrialWillEnd,
  "customer.subscription.updated": handleSubscriptionUpdated,
};

export async function dispatchStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  const stripeWebhookEventModel = GetModel(StripeWebhookEventModel);
  const claimed = await stripeWebhookEventModel.tryClaim(event.id, event.type);
  if (!claimed) return;

  const handler = HANDLERS[event.type];
  if (!handler) {
    await stripeWebhookEventModel.markResult(
      event.id,
      claimed,
      "skipped",
      null,
    );
    return;
  }

  try {
    await handler(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stripeWebhookEventModel.markResult(
      event.id,
      claimed,
      "reconciliation_required",
      message,
    );
    throw error;
  }
  await invalidatePreviewForStripeEvent(event);
  await stripeWebhookEventModel.markResult(event.id, claimed, "success", null);
}
