import { stripeDashboardUrl } from "./client";

/** The Stripe objects the back office links to. */
export type StripeDashboardObject = "customers" | "subscriptions" | "invoices";

/** The Stripe dashboard page of an object, in the mode of the configured key. */
export function stripeObjectUrl(
  object: StripeDashboardObject,
  id: string,
): string {
  return stripeDashboardUrl(`${object}/${encodeURIComponent(id)}`);
}
