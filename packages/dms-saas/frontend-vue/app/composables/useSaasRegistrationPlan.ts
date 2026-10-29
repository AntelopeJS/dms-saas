import { type MaybeRefOrGetter, ref, toValue } from 'vue'
import { rememberChosenPlan } from '../build/public/chosen-plan'
import {
	isPaidPlan,
	type RegistrationPlanSummary,
} from '../build/public/pricing'
import {
	billingUpgradePath,
	LOGIN_PATH,
	loginPathThen,
	REGISTER_PLAN_PARAM,
} from '../build/public/routes'
import {
	onPublicLocaleChange,
	usePublicFetch,
} from '../build/public/usePublicFetch'
import { REGISTRATION_LOAD_ERROR_KEY } from '../build/public/registration-errors'

const REGISTRATION_PLAN_ENDPOINT = '/api/saas/register/plan'

/**
 * Where a new account lands: sign-in, then the upgrade review on Billing
 * when the visitor chose a paid plan on Pricing.
 *
 * @param summary The registration plan summary, when it loaded
 */
export function registrationLandingPath(
	summary: RegistrationPlanSummary | null,
): string {
	const requested = summary?.requestedPlan
	if (!requested || !isPaidPlan(requested)) return LOGIN_PATH
	return loginPathThen(billingUpgradePath(requested._id))
}

/**
 * The plan a registration opens the workspace on, and the one chosen on
 * Pricing, loaded for display. The chosen plan is remembered for the tab, so
 * the OAuth round-trip back to "Set up your first workspace" keeps it.
 *
 * @param planReference Slug or id of the chosen plan
 */
export function useSaasRegistrationPlan(
	planReference: MaybeRefOrGetter<string | null | undefined>,
) {
	const publicFetch = usePublicFetch()
	const { resolveApiError } = useApiErrorMessage()
	const summary = ref<RegistrationPlanSummary | null>(null)
	const isLoading = ref(false)
	const loadError = ref<string | null>(null)

	async function load(): Promise<void> {
		isLoading.value = true
		loadError.value = null
		const plan = toValue(planReference) || undefined
		try {
			summary.value = await publicFetch<RegistrationPlanSummary>(
				REGISTRATION_PLAN_ENDPOINT,
				{ query: plan ? { [REGISTER_PLAN_PARAM]: plan } : {} },
			)
			rememberChosenPlan(summary.value.requestedPlan?._id ?? null)
		} catch (error) {
			loadError.value = resolveApiError(error, REGISTRATION_LOAD_ERROR_KEY)
		} finally {
			isLoading.value = false
		}
	}

	onPublicLocaleChange(load)

	return { summary, isLoading, loadError, load }
}
