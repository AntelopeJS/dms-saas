import type {
	DmsSaasPublicRuntimeConfig,
	DmsSaasPublicScreenId,
	RegistrationPaymentMethodPolicy,
} from '../types/runtime-config'
import { isRecord } from './type-guards'

function isPublicScreenId(value: unknown): value is DmsSaasPublicScreenId {
	return value === 'register' || value === 'pricing'
}

function isPaymentMethodPolicy(
	value: unknown,
): value is RegistrationPaymentMethodPolicy {
	return value === 'required' || value === 'optional' || value === 'none'
}

function isDmsSaasPublicRuntimeConfig(
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
