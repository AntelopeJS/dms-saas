import { Logging } from "@antelopejs/interface-core/logging";
import type Stripe from "stripe";
import { stripeSecondsToDate } from "../utils/time";
import { getStripeReadClient, isStripeConfigured } from "./client";
import { readSubscriptionPeriodEnd } from "./payload-shapes";

const LOG_PREFIX = "[dms-saas:cancellation]";

/**
 * When a subscription stops on its own: at the end of its cycle once
 * cancelled from the billing page or Stripe's portal, or on the date a
 * `cancel_at` names. Null while it renews.
 *
 * @param subscription Live Stripe subscription
 */
export function readScheduledCancellation(
  subscription: Stripe.Subscription,
): Date | null {
  if (subscription.cancel_at_period_end) {
    return readSubscriptionPeriodEnd(subscription);
  }
  return stripeSecondsToDate(subscription.cancel_at);
}

/**
 * The scheduled cancellation of a subscription, read live so a cancellation
 * made in Stripe's portal shows as well. A Stripe outage hides the notice
 * rather than failing the billing page; without usable keys nothing is read
 * nor logged, there being no live subscription to ask about.
 *
 * @param stripeSubscriptionId Subscription to read
 */
export async function fetchScheduledCancellation(
  stripeSubscriptionId: string,
): Promise<Date | null> {
  if (!isStripeConfigured()) return null;
  try {
    const subscription =
      await getStripeReadClient().subscriptions.retrieve(stripeSubscriptionId);
    return readScheduledCancellation(subscription);
  } catch (error) {
    Logging.Warn(
      `${LOG_PREFIX} could not read subscription ${stripeSubscriptionId}`,
      error,
    );
    return null;
  }
}
