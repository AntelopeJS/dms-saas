const RANGE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}
const RANGE_FORMAT_WITH_YEAR: Intl.DateTimeFormatOptions = {
	...RANGE_FORMAT,
	year: 'numeric',
}
const YEAR_KEY_LENGTH = 4

/**
 * Written by hand rather than by `Intl.DateTimeFormat.formatRange`: the
 * server's ICU and the browser's do not agree on the spaces around the dash
 * (French gets thin spaces from one, plain ones from the other), so a cell
 * rendered on the server never matched the one the browser hydrated.
 */
export const BILLING_PERIOD_SEPARATOR = ' – '

/**
 * How the bounds are written. The DMS's `regionalDateTimeFormat` and
 * `regionalDayKey` resolve the reader's time zone on the server as in the
 * browser, so both sides fall on the same days.
 */
export interface BillingPeriodFormatters {
	formatDay: (date: Date, options: Intl.DateTimeFormatOptions) => string
	/** `YYYY-MM-DD` of the day `date` falls on for the reader. */
	dayKey: (date: Date) => string
}

/** "8 Oct – 8 Nov", with the years once the period spans two. */
export function formatBillingPeriod(
	from: Date,
	to: Date | null,
	{ formatDay, dayKey }: BillingPeriodFormatters,
): string {
	if (!to) return formatDay(from, RANGE_FORMAT)
	const isSameYear =
		dayKey(from).slice(0, YEAR_KEY_LENGTH) ===
		dayKey(to).slice(0, YEAR_KEY_LENGTH)
	const format = isSameYear ? RANGE_FORMAT : RANGE_FORMAT_WITH_YEAR
	return [formatDay(from, format), formatDay(to, format)].join(
		BILLING_PERIOD_SEPARATOR,
	)
}
