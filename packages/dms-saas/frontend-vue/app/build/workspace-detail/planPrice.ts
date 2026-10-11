import { formatMinorUnits } from '../../composables/useMoneyFormat'

/** What a plan bills, as the directory and the dialogs word it. */
export interface PlanPriceTerms {
	unitAmountMinor: number
	currency: string
	interval: string
	billingMode: string
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * "€49 / seat / month" or "€29 / month", worded as `usePlanPriceLabel` words
 * a plan priced in major units.
 */
export function planPriceLabel(
	terms: PlanPriceTerms,
	t: Translate,
	locale: string,
): string {
	const price = formatMinorUnits(terms.unitAmountMinor, terms.currency, locale)
	return t(`saas.workspace.plan_price.${terms.billingMode}_${terms.interval}`, {
		price,
	})
}
