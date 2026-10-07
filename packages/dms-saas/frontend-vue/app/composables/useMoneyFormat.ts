export const MINOR_UNITS_PER_UNIT = 100

const FALLBACK_CURRENCY = 'EUR'

export interface MajorUnitsFormatOptions {
	/** Render a whole amount without decimals, e.g. `€20` instead of `€20.00`. */
	hideWholeAmountDecimals?: boolean
}

export function formatMajorUnits(
	amount: number | null | undefined,
	currency: string | null | undefined,
	locale: string,
	options: MajorUnitsFormatOptions = {},
): string {
	if (typeof amount !== 'number') return '—'
	const hasDecimalsToHide =
		options.hideWholeAmountDecimals === true && Number.isInteger(amount)
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: (currency || FALLBACK_CURRENCY).toUpperCase(),
		minimumFractionDigits: hasDecimalsToHide ? 0 : undefined,
	}).format(amount)
}

/** Amounts mirrored from a payment provider are stored in minor units. */
export function formatMinorUnits(
	amount: number | null | undefined,
	currency: string | null | undefined,
	locale: string,
): string {
	if (typeof amount !== 'number') return '—'
	return formatMajorUnits(amount / MINOR_UNITS_PER_UNIT, currency, locale)
}

/** Locale-bound view of the formatters above, for use inside components. */
export function useMoneyFormat() {
	const { locale } = useI18n()
	return {
		formatMinorUnits: (
			amount: number | null | undefined,
			currency: string | null | undefined,
		) => formatMinorUnits(amount, currency, locale.value),
		formatMajorUnits: (
			amount: number | null | undefined,
			currency: string | null | undefined,
		) => formatMajorUnits(amount, currency, locale.value),
	}
}

const DEFAULT_FRACTION_DIGITS = 2

/** Decimal places of a currency's minor unit: 2 for EUR, 0 for JPY. */
export function currencyFractionDigits(
	currency: string | null | undefined,
): number {
	return (
		new Intl.NumberFormat('en', {
			style: 'currency',
			currency: (currency || FALLBACK_CURRENCY).toUpperCase(),
		}).resolvedOptions().maximumFractionDigits ?? DEFAULT_FRACTION_DIGITS
	)
}

/**
 * An amount typed in major units (`49.5` euros) as the minor units the API and
 * Stripe use (`4950` cents), rounded to the currency's precision.
 */
export function toMinorUnits(
	amount: number,
	currency: string | null | undefined,
): number {
	return Math.round(amount * 10 ** currencyFractionDigits(currency))
}

/** Minor units (`4950`) as the major-unit amount an operator types (`49.5`). */
export function fromMinorUnits(
	amount: number,
	currency: string | null | undefined,
): number {
	return amount / 10 ** currencyFractionDigits(currency)
}
