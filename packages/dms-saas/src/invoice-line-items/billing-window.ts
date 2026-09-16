import type { InvoiceLineItemsContext } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type { TenantSubscription } from "../db";
import { isComplimentarySubscription } from "../workspaces/complimentary";

/** Clip a renewal to its own subscription's paid coverage; never invoice gifted or grace usage. */
export function clipInvoiceUsageWindow(
  context: InvoiceLineItemsContext,
  subscription: TenantSubscription | undefined,
  stripeSubscriptionId: string | null,
): InvoiceLineItemsContext | null {
  if (isComplimentarySubscription(subscription)) return null;
  if (!subscription?.paidUsagePeriods) return context;
  const period = subscription.paidUsagePeriods.find(
    (candidate) => candidate.stripeSubscriptionId === stripeSubscriptionId,
  );
  if (!period) return null;
  const periodStart = new Date(
    Math.max(context.periodStart.getTime(), new Date(period.start).getTime()),
  );
  const periodEnd = new Date(
    Math.min(
      context.periodEnd.getTime(),
      period.end ? new Date(period.end).getTime() : context.periodEnd.getTime(),
    ),
  );
  if (periodStart >= periodEnd) return null;
  return { ...context, periodStart, periodEnd };
}
