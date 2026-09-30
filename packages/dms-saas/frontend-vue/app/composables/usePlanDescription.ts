/**
 * Reader for a plan's catalogue description. It follows the DMS display
 * string convention, like feature labels: a stored value starting with `$` is
 * an i18n key the module seeding the plan ships in its own locales, anything
 * else is shown as written.
 */
export function usePlanDescription() {
	const { processI18n } = useTranslation()

	return (description: string | null | undefined): string =>
		description ? processI18n(description) : ''
}
