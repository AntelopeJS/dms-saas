/** How a plan bills: one price for the workspace, or a price per seat. */
export type PlanBillingMode = 'flat' | 'seat'

/** The price fields a plan label is written from. */
export interface PricedPlan {
	/** Minor units, as stored. */
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
	const { formatMinorUnits } = useMoneyFormat()
	return (plan) => {
		if (plan.price <= FREE_PRICE) return t(`${KEY_PREFIX}.free`)
		return t(`${KEY_PREFIX}.${plan.billingMode}_${plan.interval}`, {
			price: formatMinorUnits(plan.price, plan.currency),
		})
	}
}
