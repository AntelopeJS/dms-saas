const CONTENT_LANGUAGE_HEADER = 'x-content-language'

interface DmsPublicRuntime {
	baseURL: string
}

/**
 * Fetch for the anonymous screens, on the DMS API in the reader's locale.
 *
 * Not `$authFetch`: its 401 handling sends a visitor without a session to
 * sign-in, while these screens must show their own state for an expired
 * sign-up token. Called after mount only, so it never runs during SSR, where
 * the API base URL may not be reachable.
 */
export function usePublicFetch() {
	const config = useDmsRuntimeConfig()
	const { locale } = useI18n()
	const dmsRuntime = config.public.dms as DmsPublicRuntime
	return $fetch.create({
		baseURL: dmsRuntime.baseURL,
		headers: { [CONTENT_LANGUAGE_HEADER]: locale.value },
	})
}
