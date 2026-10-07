import { isStripeTestMode } from "./client";

const DASHBOARD_ORIGIN = "https://dashboard.stripe.com";
const TEST_MODE_SEGMENT = "/test";

/** The Stripe objects the back office links to. */
export type StripeDashboardObject = "customers" | "subscriptions" | "invoices";

/** The Stripe dashboard page of an object, in the mode of the configured key. */
export function stripeDashboardUrl(
  object: StripeDashboardObject,
  id: string,
): string {
  const mode = isStripeTestMode() ? TEST_MODE_SEGMENT : "";
  return `${DASHBOARD_ORIGIN}${mode}/${object}/${encodeURIComponent(id)}`;
}
