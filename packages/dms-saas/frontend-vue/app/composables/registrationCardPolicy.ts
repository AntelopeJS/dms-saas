import type { RegistrationPlanSummary } from '../build/public/pricing'

type PaymentStepRule = (skipsPaymentMethod: boolean) => boolean

const DEFAULT_PAYMENT_POLICY: RegistrationPaymentMethodPolicy = 'required'

const PAYMENT_STEP_RULES: Record<
	RegistrationPaymentMethodPolicy,
	PaymentStepRule
> = {
	required: () => true,
	optional: (skipsPaymentMethod) => !skipsPaymentMethod,
	none: () => false,
}

/**
 * The card policy a sign-up screen follows: the one the backend applies, from
 * the registration plan summary, once it has loaded. Until then, the policy
 * the deployment published, falling back to the backend's own default. The
 * published policy is the configured one: the frontend server cannot tell
 * whether the backend holds a usable Stripe key.
 *
 * @param config dms-saas public runtime config
 * @param summary The registration plan summary, once it has loaded
 * @returns The applied policy, else the configured one, else `required`
 */
export function resolveRegistrationPaymentPolicy(
	config: DmsSaasPublicRuntimeConfig | undefined,
	summary?: Pick<RegistrationPlanSummary, 'paymentMethod'> | null,
): RegistrationPaymentMethodPolicy {
	return (
		[summary?.paymentMethod, config?.registrationPaymentMethod].find(
			isPaymentPolicy,
		) ?? DEFAULT_PAYMENT_POLICY
	)
}

function isPaymentPolicy(
	policy: string | undefined,
): policy is RegistrationPaymentMethodPolicy {
	return !!policy && policy in PAYMENT_STEP_RULES
}

/**
 * Whether the registration still collects a card.
 *
 * @param policy Configured card policy
 * @param skipsPaymentMethod Whether the visitor chose to add a card later
 * @returns True when the card step is shown and must be completed
 */
export function isPaymentStepShown(
	policy: RegistrationPaymentMethodPolicy,
	skipsPaymentMethod: boolean,
): boolean {
	return PAYMENT_STEP_RULES[policy](skipsPaymentMethod)
}
