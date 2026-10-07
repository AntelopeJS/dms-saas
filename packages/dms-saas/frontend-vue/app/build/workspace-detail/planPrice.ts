import { formatMinorUnits } from '../../composables/useMoneyFormat'

/** What a plan bills, as the directory and the dialogs word it. */
export interface PlanPriceTerms {
	unitAmountMinor: number
	currency: string
	interval: string
	billingMode: string
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** "€49 / seat / month" or "€29 / month". */
export function planPriceLabel(
	terms: PlanPriceTerms,
	t: Translate,
	locale: string,
): string {
	const price = formatMinorUnits(terms.unitAmountMinor, terms.currency, locale)
	const interval = t(`saas.workspaces.interval.${terms.interval}`)
	const key = terms.billingMode === 'seat' ? 'price_per_seat' : 'price_flat'
	return t(`saas.workspaces.plan_cell.${key}`, { price, interval })
}
