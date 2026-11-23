import { isApiFailure } from './useApiErrorMessage'
import { CHECKOUT_OPERATION_PARAM, type PendingCheckout } from './useTenantPlan'

const CHECKOUT_IN_PROGRESS_KEY = 'saas.errors.plan.checkout_in_progress'
const PROMPT_STATE_KEY = 'saas-pending-checkout-prompt'
const CHECKOUT_CANCELLED_PARAM = 'checkout'
const CHECKOUT_CANCELLED_VALUE = 'cancelled'

/** A plan change refused because an earlier checkout is still pending. */
export interface PendingCheckoutPrompt {
	/** The plan the owner just chose, which starting over checks out. */
	planId: string
	pending: PendingCheckout | null
}

export function isCheckoutInProgressError(error: unknown): boolean {
	return (
		isApiFailure(error) && readApiErrorKey(error) === CHECKOUT_IN_PROGRESS_KEY
	)
}

function isText(value: unknown): value is string {
	return typeof value === 'string'
}

/**
 * The owner's way out of a checkout they left unpaid: resume it, or give it
 * up and start over. The prompt state is shared so the plan modals can raise
 * it and the plan card, which outlives them, can host it.
 *
 * `offerFor` raises the prompt when its error is a pending-checkout refusal,
 * `startOver` gives up the pending checkout then opens one for the chosen plan.
 * Stripe's cancel link lands back on the billing page naming the checkout the
 * owner walked out of: `consumeCancelledCheckout` releases it so they can
 * choose again at once, and drops the marker either way so a reload does not
 * replay it.
 */
export function usePendingCheckout() {
	const prompt = useDmsState<PendingCheckoutPrompt | null>(
		PROMPT_STATE_KEY,
		() => null,
	)
	const route = useDmsRoute()
	const router = useDmsRouter()
	const { loadPendingCheckout, cancelCheckout, changePlan } =
		useTenantPlanChanges()

	async function offerFor(error: unknown, planId: string): Promise<boolean> {
		if (isCheckoutInProgressError(error)) {
			const { pending } = await loadPendingCheckout().catch(() => ({
				pending: null,
			}))
			prompt.value = { planId, pending }
			return true
		}
		return false
	}

	function resume(): void {
		const url = prompt.value?.pending?.checkoutUrl
		if (url && typeof window !== 'undefined') window.location.href = url
	}

	async function startOver(): Promise<void> {
		const planId = prompt.value?.planId
		if (!planId) return
		await cancelCheckout()
		const result = await changePlan(planId)
		if (result.checkoutUrl && typeof window !== 'undefined') {
			window.location.href = result.checkoutUrl
		}
	}

	function cancelledOperationId(): string | null {
		const { query } = route
		const operationId = query[CHECKOUT_OPERATION_PARAM]
		if (query[CHECKOUT_CANCELLED_PARAM] !== CHECKOUT_CANCELLED_VALUE) {
			return null
		}
		return isText(operationId) && operationId ? operationId : null
	}

	async function consumeCancelledCheckout(): Promise<CancelCheckoutResult> {
		const operationId = cancelledOperationId()
		if (!operationId) return { released: false }
		const {
			[CHECKOUT_CANCELLED_PARAM]: _cancelled,
			[CHECKOUT_OPERATION_PARAM]: _operation,
			...query
		} = route.query
		try {
			return await cancelCheckout(operationId)
		} finally {
			await router.replace({ query })
		}
	}

	return { prompt, offerFor, resume, startOver, consumeCancelledCheckout }
}
