import type { PlanInterval } from './usePlanIntervalLabel'

const FREE_PLAN_PRICE = 0

const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
	month: 1,
	year: 12,
}

const SEAT_BILLING_MODE = 'seat'
const MIN_BILLED_SEATS = 1

export interface PlanPricing {
	price: number
	interval: PlanInterval
	billingMode?: string
}

/** What a plan bills per month for `seats` seats. */
function monthlyCost(plan: PlanPricing, seats: number): number {
	const units =
		plan.billingMode === SEAT_BILLING_MODE
			? Math.max(MIN_BILLED_SEATS, seats)
			: 1
	return (plan.price * units) / MONTHS_PER_INTERVAL[plan.interval]
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
 * @param seats Seats the workspace uses; a per-seat price counts them
 * @returns True when the change is a downgrade
 */
export function isPlanDowngrade(
	current: PlanPricing | null,
	target: PlanPricing,
	isCurrentPaid: boolean,
	seats = MIN_BILLED_SEATS,
): boolean {
	if (current) return monthlyCost(target, seats) < monthlyCost(current, seats)
	return isCurrentPaid && target.price === FREE_PLAN_PRICE
}

/**
 * Whether a plan is free.
 *
 * @param plan Plan to inspect
 * @returns True when the plan costs nothing
 */
export function isFreePlan(plan: PlanPricing): boolean {
	return plan.price === FREE_PLAN_PRICE
}
