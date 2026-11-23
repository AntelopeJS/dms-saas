import { isRecord } from '../build/type-guards'
/**
 * Whether registration asks for a card, as the deployment configured it in
 * `registration.paymentMethod`: `required` always does, `optional` lets the
 * visitor skip it, `none` never shows the card step and never calls Stripe.
 */
export type RegistrationPaymentMethodPolicy = 'required' | 'optional' | 'none'

/** The bundled public screens a deployment may turn off (`publicScreens`). */
export type DmsSaasPublicScreenId = 'register' | 'pricing'

/** What dms-saas publishes to the browser through the frontend module options. */
export interface DmsSaasPublicRuntimeConfig {
	stripePublishableKey?: string
	admissionMode?: 'open' | 'invitation-only'
	registrationPaymentMethod?: RegistrationPaymentMethodPolicy
	/** The bundled public screens this deployment serves. */
	publicScreens?: DmsSaasPublicScreenId[]
}

function isPublicScreenId(value: unknown): value is DmsSaasPublicScreenId {
	return value === 'register' || value === 'pricing'
}

function isPaymentMethodPolicy(
	value: unknown,
): value is RegistrationPaymentMethodPolicy {
	return value === 'required' || value === 'optional' || value === 'none'
}

/** Whether the value is what dms-saas publishes under `public.dmsSaas`. */
export function isDmsSaasPublicRuntimeConfig(
	value: unknown,
): value is DmsSaasPublicRuntimeConfig {
	if (!isRecord(value)) return false
	const { stripePublishableKey, admissionMode, registrationPaymentMethod } =
		value
	const { publicScreens } = value
	return (
		(stripePublishableKey === undefined ||
			typeof stripePublishableKey === 'string') &&
		(admissionMode === undefined ||
			admissionMode === 'open' ||
			admissionMode === 'invitation-only') &&
		(registrationPaymentMethod === undefined ||
			isPaymentMethodPolicy(registrationPaymentMethod)) &&
		(publicScreens === undefined ||
			(Array.isArray(publicScreens) && publicScreens.every(isPublicScreenId)))
	)
}

/**
 * The dms-saas options of the runtime config's public part.
 *
 * @param published `useDmsRuntimeConfig().public.dmsSaas`
 * @returns The published options, or `undefined` when the backend publishes none
 */
export function readDmsSaasPublicConfig(
	published: unknown,
): DmsSaasPublicRuntimeConfig | undefined {
	return isDmsSaasPublicRuntimeConfig(published) ? published : undefined
}
