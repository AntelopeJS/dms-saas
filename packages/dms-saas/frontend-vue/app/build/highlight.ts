/** One run of a text, flagged when it matches the searched needle. */
export interface HighlightPart {
	text: string
	isMatch: boolean
}

/**
 * Splits a text around every case-insensitive occurrence of a needle, so a
 * search result can mark what matched.
 */
export function highlightParts(text: string, needle: string): HighlightPart[] {
	const query = needle.trim().toLowerCase()
	if (!query) return [{ text, isMatch: false }]
	const parts: HighlightPart[] = []
	const lower = text.toLowerCase()
	let cursor = 0
	let found = lower.indexOf(query, cursor)
	while (found !== -1) {
		if (found > cursor)
			parts.push({ text: text.slice(cursor, found), isMatch: false })
		parts.push({ text: text.slice(found, found + query.length), isMatch: true })
		cursor = found + query.length
		found = lower.indexOf(query, cursor)
	}
	if (cursor < text.length)
		parts.push({ text: text.slice(cursor), isMatch: false })
	return parts
}
