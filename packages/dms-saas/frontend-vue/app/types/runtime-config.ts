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
