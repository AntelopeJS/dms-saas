/**
 * How a day without its year is written: in full inside a sentence, short in
 * a compact label. French abbreviates months with a trailing dot ("11 oct."),
 * so a short day closing a sentence would end it on "..".
 */

/** A day inside a sentence ("11 October", "11 octobre"). */
export const SENTENCE_DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'long',
}

/** A day in a compact label: a timeline step, a column ("11 Oct"). */
export const LABEL_DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}
