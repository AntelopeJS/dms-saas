import type {
	DmsSaasPublicRuntimeConfig,
	DmsSaasPublicScreenId,
} from '../../types/runtime-config'

export const LOGIN_PATH = '/auth/login'
export const REGISTER_PATH = '/register'
export const PRICING_PATH = '/pricing'
export const HOME_PATH = '/'
export const BILLING_PATH = '/settings/workspace/billing'

/**
 * Query parameter of the Billing page naming the plan a new workspace owner
 * chose on Pricing: the page opens its upgrade review on it.
 */
export const BILLING_UPGRADE_PARAM = 'upgrade'

/**
 * Query parameter of the Billing page asking it to open the plan comparison:
 * how the access-restricted screen sends the owner to choose a plan.
 */
export const BILLING_CHOOSE_PLAN_PARAM = 'choose-plan'

/** Query parameter of Register naming the plan chosen on Pricing. */
export const REGISTER_PLAN_PARAM = 'plan'

/** Query parameter of a legal page naming where the visitor came from. */
export const LEGAL_FROM_PARAM = 'from'

/** A legal document served publicly, keyed like the legal documents payload. */
export type LegalDocumentField =
	| 'termsOfUse'
	| 'termsAndConditions'
	| 'privacyPolicy'

export interface LegalDocumentLink {
	field: LegalDocumentField
	path: string
	labelKey: string
	summaryKey: string
	/** Footer position, after the core's own links. */
	order: number
}

export const LEGAL_DOCUMENTS: LegalDocumentLink[] = [
	{
		field: 'termsOfUse',
		path: '/terms-of-use',
		labelKey: 'saas.legal.terms_of_use',
		summaryKey: 'saas.public.legal.summary.terms_of_use',
		order: 100,
	},
	{
		field: 'termsAndConditions',
		path: '/terms-and-conditions',
		labelKey: 'saas.legal.terms_and_conditions',
		summaryKey: 'saas.public.legal.summary.terms_and_conditions',
		order: 200,
	},
	{
		field: 'privacyPolicy',
		path: '/privacy-policy',
		labelKey: 'saas.legal.privacy_policy',
		summaryKey: 'saas.public.legal.summary.privacy_policy',
		order: 300,
	},
]

/**
 * Whether the deployment serves one of the bundled public screens. A backend
 * that publishes no list predates the option and serves them all.
 *
 * @param config dms-saas public runtime config
 * @param screen Screen id
 */
export function isPublicScreenServed(
	config: DmsSaasPublicRuntimeConfig | undefined,
	screen: DmsSaasPublicScreenId,
): boolean {
	return config?.publicScreens?.includes(screen) ?? true
}

/** Where a new workspace owner reviews the paid plan chosen on Pricing. */
export function billingUpgradePath(planId: string): string {
	return `${BILLING_PATH}?${BILLING_UPGRADE_PARAM}=${encodeURIComponent(planId)}`
}

/** The Billing page with its plan comparison open. */
export const BILLING_CHOOSE_PLAN_PATH = `${BILLING_PATH}?${BILLING_CHOOSE_PLAN_PARAM}=1`

/** Sign-up link carrying the plan chosen on Pricing. */
export function registerPathFor(planReference: string): string {
	return `${REGISTER_PATH}?${REGISTER_PLAN_PARAM}=${encodeURIComponent(planReference)}`
}

/** Sign-in, then straight to `destination` once the session exists. */
export function loginPathThen(destination: string | null): string {
	if (!destination) return LOGIN_PATH
	return `${LOGIN_PATH}?redirect=${encodeURIComponent(destination)}`
}

/** An in-app path, never another origin: `/x` but not `//x` or `/\x`. */
export function isInAppPath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.startsWith('/') &&
		!value.startsWith('//') &&
		!value.startsWith('/\\')
	)
}
