/** How Stripe computes a subscription's prorations and invoices. */
interface SubscriptionBillingMode {
  type: "classic";
}

/**
 * Since API version 2025-09-30.clover a new subscription defaults to the
 * `flexible` billing mode, which never resets the billing cycle anchor on a
 * price change (a free-to-paid upgrade is no longer invoiced at once) and
 * records Customer Portal cancellations as `cancel_at` rather than
 * `cancel_at_period_end`. Every subscription dms-saas created before is
 * `classic`, and its plan-change flows rely on that, so new ones stay
 * `classic` too. A subscription's mode cannot be moved back to `classic`.
 */
export const SUBSCRIPTION_BILLING_MODE: SubscriptionBillingMode = {
  type: "classic",
};
