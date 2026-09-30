import type Stripe from "stripe";
import type { Plan } from "../db";
import { SUBSCRIPTION_BILLING_MODE } from "../stripe/billing-mode";

const SEAT_BILLING_INITIAL_QUANTITY = 1;

/** The Stripe subscription a provisioned workspace is billed through. */
export function buildSubscriptionCreateParams(
  stripeCustomerId: string,
  stripePriceId: string,
  plan: Plan,
  grantTrial: boolean,
): Stripe.SubscriptionCreateParams {
  const quantity =
    plan.billingMode === "seat" ? SEAT_BILLING_INITIAL_QUANTITY : undefined;
  return {
    customer: stripeCustomerId,
    items: [{ price: stripePriceId, quantity }],
    trial_period_days: grantTrial ? plan.trialDays : undefined,
    automatic_tax: { enabled: true },
    billing_mode: SUBSCRIPTION_BILLING_MODE,
    // Create the subscription without settling its first invoice. The charge is
    // deferred to settleSubscriptionPayment, run only once the workspace, its
    // records and every TENANT_BEING_PROVISIONED listener have succeeded — so a
    // failure before then cancels an unpaid (incomplete) subscription, with
    // nothing to refund, instead of leaving a rolled-back workspace billed.
    payment_behavior: "default_incomplete",
  };
}
