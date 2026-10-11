const MS_PER_DAY = 86_400_000

/**
 * Whole days from `now` until `date`, a started day counting as one; 0 once
 * the date is past.
 */
export function countDaysUntil(date: string | Date, now: Date): number {
	const remaining = new Date(date).getTime() - now.getTime()
	return remaining > 0 ? Math.ceil(remaining / MS_PER_DAY) : 0
}

/** Whole days between two dates, rounded down. */
export function countDaysBetween(
	from: string | Date,
	to: string | Date,
): number {
	return Math.floor(
		(new Date(to).getTime() - new Date(from).getTime()) / MS_PER_DAY,
	)
}
