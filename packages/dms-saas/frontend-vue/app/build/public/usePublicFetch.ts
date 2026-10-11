import { watch } from 'vue'

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
 * the API base URL may not be reachable. The locale is read on each request,
 * not when the fetch is created: a visitor who switches language gets the
 * next answer in the new one.
 */
export function usePublicFetch() {
	const config = useDmsRuntimeConfig()
	const { locale } = useI18n()
	const dmsRuntime = config.public.dms as DmsPublicRuntime
	return $fetch.create({
		baseURL: dmsRuntime.baseURL,
		onRequest({ options }) {
			const headers = new Headers(options.headers)
			headers.set(CONTENT_LANGUAGE_HEADER, locale.value)
			options.headers = headers
		},
	})
}

/**
 * Runs `reload` each time the reader switches language, so the texts the API
 * localizes (feature names, units) follow the switch without a page reload.
 *
 * @param reload Loads the screen's data again
 */
export function onPublicLocaleChange(reload: () => unknown): void {
	const { locale } = useI18n()
	watch(locale, () => {
		void reload()
	})
}
