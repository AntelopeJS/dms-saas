import type { PlanBillingMode } from './useTenantPlan'

/** The price fields a plan label is written from. */
export interface PricedPlan {
	/** Major units, as plans store it (49 for €49). */
	price: number
	currency: string
	interval: PlanInterval
	billingMode: PlanBillingMode
}

const KEY_PREFIX = 'saas.workspace.plan_price'
const FREE_PRICE = 0

/**
 * A plan's price as customers read it: "€49.00 / seat / month",
 * "€29.00 / month", or "Free".
 */
export function usePlanPriceLabel(): (plan: PricedPlan) => string {
	const { t } = useI18n()
	const { formatMajorUnits } = useMoneyFormat()
	return (plan) => {
		if (plan.price <= FREE_PRICE) return t(`${KEY_PREFIX}.free`)
		return t(`${KEY_PREFIX}.${plan.billingMode}_${plan.interval}`, {
			price: formatMajorUnits(plan.price, plan.currency),
		})
	}
}
