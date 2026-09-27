import { Logging } from "@antelopejs/interface-core/logging";
import type Stripe from "stripe";
import { asCustomerId, findTenantByCustomerId } from "../stripe/webhook-shared";
import { invalidateUpcomingInvoicePreview } from "./preview";

const LOG_PREFIX = "[dms-saas:upcoming-invoice]";
const CUSTOMER_OBJECT = "customer";

/**
 * Events after which Stripe would price the next invoice differently: an
 * invoice was opened or settled (the upcoming one moves to the next cycle), the
 * subscription changed (plan, quantity, cancellation), or the customer's
 * billing identity changed (address, tax exemption).
 */
const INVALIDATING_EVENT_TYPES = new Set<string>([
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.voided",
  "customer.updated",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

interface CustomerOwnedObject {
  object?: string;
  id?: string;
  customer?: unknown;
}

function eventCustomerId(event: Stripe.Event): string | null {
  const object = event.data.object as CustomerOwnedObject;
  if (object.object === CUSTOMER_OBJECT) return object.id ?? null;
  return asCustomerId(object.customer);
}

/**
 * Drop the cached preview of the workspace a handled Stripe event concerns.
 * A failure is logged, never thrown: the event itself was handled, and the
 * cache lifetime still bounds how long a stale preview can be served.
 */
export async function invalidatePreviewForStripeEvent(
  event: Stripe.Event,
): Promise<void> {
  if (!INVALIDATING_EVENT_TYPES.has(event.type)) return;
  const customerId = eventCustomerId(event);
  if (!customerId) return;
  try {
    const tenant = await findTenantByCustomerId(customerId);
    if (tenant) await invalidateUpcomingInvoicePreview(tenant._id);
  } catch (error) {
    Logging.Error(
      `${LOG_PREFIX} could not invalidate the preview after ${event.type} ${event.id}`,
      error,
    );
  }
}
