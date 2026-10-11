import { formatMajorUnits } from '../../composables/useMoneyFormat'
import { type PublicPlan, seatExample } from './pricing'

const PRICE_KEYS: Record<PublicPlan['billingMode'], string> = {
	flat: 'saas.public.plan.price.flat',
	seat: 'saas.public.plan.price.seat',
}

/** Locale-bound wording of a public plan's price, trial and seat example. */
export function usePublicPlanFormat() {
	const { t, locale } = useI18n()

	function money(amount: number, currency: string): string {
		return formatMajorUnits(amount, currency, locale.value, {
			hideWholeAmountDecimals: true,
		})
	}

	function intervalLabel(plan: PublicPlan): string {
		return t(`saas.public.plan.interval.${plan.interval}`)
	}

	/** `€29 / month`, `€49 / member / month`. */
	function priceLabel(plan: PublicPlan): string {
		return t(PRICE_KEYS[plan.billingMode], {
			price: money(plan.price, plan.currency),
			interval: intervalLabel(plan),
		})
	}

	/** `10 members = €490 a month`, or null for a flat price. */
	function seatExampleLabel(plan: PublicPlan): string | null {
		const example = seatExample(plan)
		if (!example) return null
		return t('saas.public.plan.seat_example', {
			seats: String(example.seats),
			total: money(example.total, plan.currency),
			interval: intervalLabel(plan),
		})
	}

	/** `14-day free trial`, `Free forever`, or null for a paid plan without trial. */
	function termsLabel(plan: PublicPlan): string | null {
		if (plan.price <= 0) return t('saas.public.plan.free_forever')
		if (plan.trialDays > 0) {
			return t('saas.public.plan.trial', { days: String(plan.trialDays) })
		}
		return null
	}

	return { money, priceLabel, seatExampleLabel, termsLabel, intervalLabel }
}
