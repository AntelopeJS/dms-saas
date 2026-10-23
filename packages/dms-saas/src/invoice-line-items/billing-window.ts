import type { TenantSubscription } from "../db";
import { isComplimentarySubscription } from "../workspaces/complimentary";

/** A half-open usage window, `[periodStart, periodEnd)`. */
interface UsageWindow {
  periodStart: Date;
  periodEnd: Date;
}

/** Clip a renewal to its own subscription's paid coverage; never invoice gifted or grace usage. */
export function clipInvoiceUsageWindow<Window extends UsageWindow>(
  context: Window,
  subscription: TenantSubscription | undefined,
  stripeSubscriptionId: string | null,
): Window | null {
  if (!subscription) return context;
  if (isComplimentarySubscription(subscription)) return null;
  const period = subscription.paidUsagePeriods.find(
    (candidate) => candidate.stripeSubscriptionId === stripeSubscriptionId,
  );
  if (!period) return null;
  const periodStart = new Date(
    Math.max(context.periodStart.getTime(), new Date(period.start).getTime()),
  );
  const downgrade = subscription.guardedPlanChange;
  const paidEnd =
    downgrade?.stripeSubscriptionId === stripeSubscriptionId &&
    ["scheduled", "effective", "activating", "blocked"].includes(
      downgrade.phase,
    )
      ? new Date(downgrade.effectiveAt).getTime()
      : context.periodEnd.getTime();
  const periodEnd = new Date(
    Math.min(
      context.periodEnd.getTime(),
      period.end ? new Date(period.end).getTime() : context.periodEnd.getTime(),
      paidEnd,
    ),
  );
  if (periodStart >= periodEnd) return null;
  return { ...context, periodStart, periodEnd };
}
