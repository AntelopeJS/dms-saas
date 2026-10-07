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
