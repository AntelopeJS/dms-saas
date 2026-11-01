import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { StripeWebhookEventModel } from "../db";
import { handleSubscriptionPendingUpdateApplied } from "../plan-changes/applied-upgrade";
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

/** Each Stripe event, by its type. */
type StripeEventsByType = {
  [Type in Stripe.Event.Type]: Extract<Stripe.Event, { type: Type }>;
};

/** A handler takes the event of the type it is registered for. */
type WebhookHandlers = {
  [Type in Stripe.Event.Type]?: (
    event: StripeEventsByType[Type],
  ) => Promise<void>;
};

const HANDLERS: WebhookHandlers = {
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
  "customer.subscription.pending_update_applied":
    handleSubscriptionPendingUpdateApplied,
};

/**
 * The registered handler of an event's type, bound to the event.
 *
 * @param type The event's type
 * @param event The event
 */
function handlerFor<Type extends Stripe.Event.Type>(
  type: Type,
  event: StripeEventsByType[Type],
): (() => Promise<void>) | undefined {
  const handler = HANDLERS[type];
  return handler && (() => handler(event));
}

export async function dispatchStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  const stripeWebhookEventModel = GetModel(StripeWebhookEventModel);
  const claimed = await stripeWebhookEventModel.tryClaim(event.id, event.type);
  if (!claimed) return;

  const handler = handlerFor(event.type, event);
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
    await handler();
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
