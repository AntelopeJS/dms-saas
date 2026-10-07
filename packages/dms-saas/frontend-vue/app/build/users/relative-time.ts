const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60],
	['second', 1],
]
const MS_PER_SECOND = 1000

/** "12 minutes ago", "in 3 days": a date as the distance to now. */
export function formatRelativeTime(
	date: string | Date | null | undefined,
	locale: string,
	now: number = Date.now(),
): string | null {
	if (!date) return null
	const seconds = (new Date(date).getTime() - now) / MS_PER_SECOND
	const [unit, size] =
		UNITS.find(([, unitSeconds]) => Math.abs(seconds) >= unitSeconds) ??
		UNITS[UNITS.length - 1]!
	return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
		Math.round(seconds / size),
		unit,
	)
}
