import { readDmsSaasPublicConfig } from '../build/saas-public-config'

const UPGRADE_AUTHENTICATION_ENDPOINT = '/api/saas/tenant/plan/authentication'

/**
 * The 3D Secure leg of an immediate upgrade. Whatever the challenge's outcome,
 * the server settles the upgrade from the payment Stripe holds: it applies the
 * plan once paid, and drops the change when the owner did not pass. Stripe.js
 * failing to load is an abandoned challenge, which the confirm call reports.
 */
export function useUpgradeAuthentication() {
	const { $authFetch } = useAuthFetch()
	const config = useDmsRuntimeConfig()

	async function runChallenge(clientSecret: string): Promise<void> {
		const published = config.public.dmsSaas
		const publishableKey =
			readDmsSaasPublicConfig(published)?.stripePublishableKey
		if (!publishableKey) return
		const { loadStripe } = await import('@stripe/stripe-js')
		const stripe = await loadStripe(publishableKey)
		await stripe?.handleNextAction({ clientSecret })
	}

	async function authenticateUpgrade(
		planId: string,
		authentication: UpgradeAuthentication,
	): Promise<ChangePlanResult> {
		await runChallenge(authentication.clientSecret).catch(() => undefined)
		return $authFetch<ChangePlanResult>(UPGRADE_AUTHENTICATION_ENDPOINT, {
			method: 'POST',
			body: { planId },
		})
	}

	return { authenticateUpgrade }
}
