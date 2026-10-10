import type { TenantSubscription } from "../db";
import { canRecoverComplimentarySubscription } from "./complimentary";

const PENDING_PAYMENT_STATUS = "pending_payment";

/**
 * A workspace waiting for its first payment: created by an operator for its
 * owner to pay, or left by a checkout never completed. No Stripe
 * subscription exists yet, so nothing is owed — the owner only has to pay.
 */
export function awaitsFirstPayment(
  subscription: TenantSubscription | null | undefined,
): boolean {
  return (
    subscription?.status === PENDING_PAYMENT_STATUS &&
    !subscription.stripeSubscriptionId &&
    !subscription.isComplimentary &&
    !subscription.deletionStartedAt
  );
}

/**
 * Whether the owner of a blocked workspace may start its first paid
 * subscription through checkout: an expired gift, or a workspace waiting for
 * its first payment. Both bypass the access gate on the plan routes.
 */
export function canStartFirstPaidSubscription(
  subscription: TenantSubscription | null | undefined,
  now = new Date(),
): boolean {
  return (
    canRecoverComplimentarySubscription(subscription, now) ||
    awaitsFirstPayment(subscription)
  );
}

const CANCELLED_STATUS = "cancelled";

/**
 * Whether the owner of a cancelled workspace may bring it back by choosing a
 * plan again: its data is kept until the retention cron admits its deletion,
 * and so is its Stripe customer, which the new subscription reuses.
 */
export function canResubscribe(
  subscription: TenantSubscription | null | undefined,
): boolean {
  return (
    subscription?.status === CANCELLED_STATUS && !subscription.deletionStartedAt
  );
}

/**
 * The Stripe subscription the workspace still bills on. A cancelled
 * workspace keeps the id of the subscription Stripe ended, which nothing may
 * change, renew or price any more.
 */
export function liveStripeSubscriptionId(
  subscription: TenantSubscription | null | undefined,
): string | null {
  if (subscription?.status === CANCELLED_STATUS) return null;
  return subscription?.stripeSubscriptionId ?? null;
}
