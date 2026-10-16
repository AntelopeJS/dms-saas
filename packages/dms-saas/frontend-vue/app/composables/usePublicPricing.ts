import type { PublicPricing } from '../build/public/pricing'

const PRICING_ENDPOINT = '/api/saas/pricing'
const PRICING_KEY = 'saas:public-pricing'
const CONTENT_LANGUAGE_HEADER = 'x-content-language'

/**
 * The plans on sale and the billing rules the pricing page shows, read with
 * the page: a server render hands them over in the visitor's language. The
 * key names that language, so a switch reads them again in the new one (the
 * API localizes feature names and units). The language goes with each
 * request: `$authFetch` keeps the one it was created in.
 */
export function usePublicPricing() {
	const { locale } = useI18n()
	return useApiData<PublicPricing>(
		() => `${PRICING_KEY}:${locale.value}`,
		({ $authFetch, signal }) =>
			$authFetch<PublicPricing>(PRICING_ENDPOINT, {
				signal,
				headers: { [CONTENT_LANGUAGE_HEADER]: locale.value },
			}),
	)
}
