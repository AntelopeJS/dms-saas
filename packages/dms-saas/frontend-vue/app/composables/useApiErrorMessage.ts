/** The i18n key the server answered a failed `$authFetch` with, if any. */
export function readApiErrorKey(error: unknown): string | undefined {
	const data = (error as { data?: unknown } | undefined)?.data
	if (typeof data === 'string') return data
	const message = (data as { message?: unknown } | undefined)?.message
	return typeof message === 'string' ? message : undefined
}
