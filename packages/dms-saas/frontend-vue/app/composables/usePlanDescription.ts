/**
 * Reader for the display strings written on a plan: its catalogue
 * description and its badge (`borderLabel`). They follow the DMS display
 * string convention, like feature labels: a stored value starting with `$` is
 * an i18n key the module seeding the plan ships in its own locales, anything
 * else is shown as written.
 *
 * The plan name is not read through it: Stripe, invoices and e-mails show the
 * name as stored, so it stays plain text.
 */
export function usePlanDisplayText() {
	const { processI18n } = useTranslation()

	return (text: string | null | undefined): string =>
		text ? processI18n(text) : ''
}

/** Reader for a plan's catalogue description, see {@link usePlanDisplayText}. */
export function usePlanDescription() {
	return usePlanDisplayText()
}
