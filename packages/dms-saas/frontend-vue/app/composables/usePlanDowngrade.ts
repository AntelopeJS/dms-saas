import type { PlanInterval } from "./usePlanIntervalLabel";

const FREE_PLAN_PRICE = 0;

const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  month: 1,
  year: 12,
};

export interface PlanPricing {
  price: number;
  interval: PlanInterval;
}

function monthlyPrice(plan: PlanPricing): number {
  return plan.price / MONTHS_PER_INTERVAL[plan.interval];
}

/**
 * Whether choosing `target` lowers what the workspace pays, which is when the
 * customer must confirm before losing the features and limits of the current
 * plan. Mirrors the server's `isDowngrade`; the paid-to-free fallback covers a
 * current plan that is no longer offered and so is missing from the catalog.
 *
 * @param current Current plan as listed in the catalog, if it is listed
 * @param target Plan the customer picked
 * @param isCurrentPaid Whether the workspace currently pays for its plan
 * @returns True when the change is a downgrade
 */
export function isPlanDowngrade(
  current: PlanPricing | null,
  target: PlanPricing,
  isCurrentPaid: boolean,
): boolean {
  if (current) return monthlyPrice(target) < monthlyPrice(current);
  return isCurrentPaid && target.price === FREE_PLAN_PRICE;
}

/**
 * Whether a plan is free.
 *
 * @param plan Plan to inspect
 * @returns True when the plan costs nothing
 */
export function isFreePlan(plan: PlanPricing): boolean {
  return plan.price === FREE_PLAN_PRICE;
}
