/** Builds the `Intl.DateTimeFormat` a period is written with. */
export type DateFormatFactory = (
	locale: string,
	options: Intl.DateTimeFormatOptions,
) => Intl.DateTimeFormat

const RANGE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}
const RANGE_FORMAT_WITH_YEAR: Intl.DateTimeFormatOptions = {
	...RANGE_FORMAT,
	year: 'numeric',
}
const YEAR_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric' }

/**
 * Thin and narrow no-break spaces. Recent ICU data (Node 24) puts thin spaces
 * around a range's dash ("15 oct. – 15 nov.") where a browser's
 * older data puts plain ones, so a server-rendered period would not hydrate.
 */
const ICU_SPACES = /[  ]/g

const intlFormat: DateFormatFactory = (locale, options) =>
	new Intl.DateTimeFormat(locale, options)

/**
 * "Sep 29 – Oct 28", with the years once the period spans two; a lone start
 * when the end is unknown. Written the same by every ICU version, so a server
 * render and the browser agree.
 *
 * @param createFormat Builds the formatters; the console passes the one that
 * applies the reader's time zone, so the year test runs in that zone too
 */
export function formatPeriodRange(
	from: Date,
	to: Date | null,
	locale: string,
	createFormat: DateFormatFactory = intlFormat,
): string {
	const text = to
		? formatRange(from, to, locale, createFormat)
		: createFormat(locale, RANGE_FORMAT).format(from)
	return text.replace(ICU_SPACES, ' ')
}

function formatRange(
	from: Date,
	to: Date,
	locale: string,
	createFormat: DateFormatFactory,
): string {
	const year = createFormat(locale, YEAR_FORMAT)
	const isSameYear = year.format(from) === year.format(to)
	const format = isSameYear ? RANGE_FORMAT : RANGE_FORMAT_WITH_YEAR
	return createFormat(locale, format).formatRange(from, to)
}
