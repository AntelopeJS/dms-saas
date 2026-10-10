import {
	isPublicScreenServed,
	PRICING_PATH,
	REGISTER_PATH,
} from '../build/public/routes'

const LOGIN_PAGE = 'login'
const REGISTER_LINK_ID = 'saas-login-register'
const REGISTER_LINK_LABEL = 'saas.public.auth_links.create_account'
const REGISTER_LINK_ORDER = 100
const PRICING_LINK_ID = 'saas-login-pricing'
const PRICING_LINK_LABEL = 'saas.public.auth_links.pricing'
const PRICING_LINK_ORDER = 200
const INVITATION_ONLY = 'invitation-only'

export default defineDmsPlugin(() => {
	const config = useDmsRuntimeConfig()
	const dmsSaas = config.public.dmsSaas as
		| DmsSaasPublicRuntimeConfig
		| undefined

	const isRegistrationOpen = dmsSaas?.admissionMode !== INVITATION_ONLY
	if (isRegistrationOpen && isPublicScreenServed(dmsSaas, 'register')) {
		registerAuthLink({
			id: REGISTER_LINK_ID,
			page: LOGIN_PAGE,
			label: REGISTER_LINK_LABEL,
			to: REGISTER_PATH,
			order: REGISTER_LINK_ORDER,
		})
	}
	if (isPublicScreenServed(dmsSaas, 'pricing')) {
		registerAuthLink({
			id: PRICING_LINK_ID,
			page: LOGIN_PAGE,
			label: PRICING_LINK_LABEL,
			to: PRICING_PATH,
			order: PRICING_LINK_ORDER,
		})
	}
})
