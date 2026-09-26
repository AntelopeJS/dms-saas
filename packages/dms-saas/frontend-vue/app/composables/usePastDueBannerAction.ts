import type { BillingStatusResponse } from "./useBillingStatus";

/**
 * What the past-due banner offers: the invoice itself when Stripe hands out
 * its payment page, else the billing page to the owner, who can settle from
 * there; a member only gets the notice, since the owner pays.
 */
export type PastDueBannerAction = "settle" | "open_billing" | "none";

type PastDueBannerStatus = Pick<
  BillingStatusResponse,
  "isTenantOwner" | "unpaidInvoice"
>;

export function resolvePastDueBannerAction(
  status: PastDueBannerStatus | null,
): PastDueBannerAction {
  if (status?.unpaidInvoice?.hostedInvoiceUrl) return "settle";
  return status?.isTenantOwner ? "open_billing" : "none";
}
