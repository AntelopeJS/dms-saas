import type { PaidUsagePeriod, TenantSubscription } from "../db";
import { isComplimentarySubscription } from "@antelopejs/interface-dms-saas/billing";
export { isComplimentarySubscription } from "@antelopejs/interface-dms-saas/billing";

/** Expiry unlocks conversion even before the expiration cron runs. */
export function isComplimentaryPlanLocked(
  subscription: TenantSubscription | null | undefined,
  now = new Date(),
): boolean {
  return (
    isComplimentarySubscription(subscription) &&
    (!subscription?.freeUntil || subscription.freeUntil > now)
  );
}

/** Only an expired gift may bypass suspension to acquire its first paid subscription. */
export function canRecoverComplimentarySubscription(
  subscription: TenantSubscription | null | undefined,
  now = new Date(),
): boolean {
  return (
    isComplimentarySubscription(subscription) &&
    !!subscription?.freeUntil &&
    subscription.freeUntil <= now &&
    !subscription.stripeSubscriptionId &&
    !subscription.deletionStartedAt
  );
}

export function paidUsagePeriods(
  subscription: TenantSubscription | null | undefined,
): PaidUsagePeriod[] {
  return subscription?.paidUsagePeriods ?? [];
}

/** Regrant closes coverage without erasing earlier paid periods. */
export function closePaidUsagePeriods(
  subscription: TenantSubscription | null | undefined,
  now: Date,
): PaidUsagePeriod[] {
  return paidUsagePeriods(subscription).map((period) => ({
    ...period,
    end: period.end ?? now,
  }));
}

/** Retries preserve the original activation boundary and never duplicate coverage. */
export function activatePaidUsage(
  subscription: TenantSubscription,
  stripeSubscriptionId: string,
  start: Date,
): Partial<TenantSubscription> {
  const periods = paidUsagePeriods(subscription);
  const existing = periods.find(
    (period) => period.stripeSubscriptionId === stripeSubscriptionId,
  );
  return {
    isComplimentary: false,
    freeUntil: null,
    paidUsageStartedAt: existing?.start ?? start,
    paidUsagePeriods: existing
      ? periods
      : [
          ...closePaidUsagePeriods(subscription, start),
          { stripeSubscriptionId, start, end: null },
        ],
  };
}
