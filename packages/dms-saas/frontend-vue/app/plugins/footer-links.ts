import { LEGAL_DOCUMENTS } from '../build/public/routes'

/** Ids stay `saas-<slug>`, e.g. `saas-privacy-policy`, for overriding apps. */
const FOOTER_LINK_ID_PREFIX = 'saas-'
const LEADING_SLASH = /^\//

export default defineDmsPlugin(() => {
	for (const document of LEGAL_DOCUMENTS) {
		registerFooterLink({
			id: `${FOOTER_LINK_ID_PREFIX}${document.path.replace(LEADING_SLASH, '')}`,
			label: document.labelKey,
			to: document.path,
			order: document.order,
		})
	}
})
