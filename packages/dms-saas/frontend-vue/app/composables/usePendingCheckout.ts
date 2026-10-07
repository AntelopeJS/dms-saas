// Imported by path: the auto-import transform misses a name used only as a
// computed key, as this file uses it.
import { CHECKOUT_OPERATION_PARAM } from './useTenantPlan'

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
	return readApiErrorKey(error) === CHECKOUT_IN_PROGRESS_KEY
}

/**
 * The owner's way out of a checkout they left unpaid: resume it, or give it
 * up and start over. The prompt state is shared so the plan modals can raise
 * it and the plan card, which outlives them, can host it.
 */
export function usePendingCheckout() {
	const prompt = useDmsState<PendingCheckoutPrompt | null>(
		PROMPT_STATE_KEY,
		() => null,
	)
	const route = useDmsRoute()
	const router = useDmsRouter()
	const { loadPendingCheckout, cancelCheckout, changePlan } = useTenantPlan()

	/** Raises the prompt when `error` is a pending-checkout refusal. */
	async function offerFor(error: unknown, planId: string): Promise<boolean> {
		if (!isCheckoutInProgressError(error)) return false
		const { pending } = await loadPendingCheckout().catch(() => ({
			pending: null,
		}))
		prompt.value = { planId, pending }
		return true
	}

	function resume(): void {
		const url = prompt.value?.pending?.checkoutUrl
		if (url && typeof window !== 'undefined') window.location.href = url
	}

	/** Gives up the pending checkout, then opens one for the chosen plan. */
	async function startOver(): Promise<void> {
		const planId = prompt.value?.planId
		if (!planId) return
		await cancelCheckout()
		const result = await changePlan(planId)
		if (result.checkoutUrl && typeof window !== 'undefined') {
			window.location.href = result.checkoutUrl
		}
	}

	/** The operation named by the Stripe cancel link the page was opened from. */
	function cancelledOperationId(): string | null {
		const { query } = route
		const operationId = query[CHECKOUT_OPERATION_PARAM]
		if (query[CHECKOUT_CANCELLED_PARAM] !== CHECKOUT_CANCELLED_VALUE) {
			return null
		}
		return typeof operationId === 'string' && operationId ? operationId : null
	}

	/**
	 * Stripe's cancel link lands back on the billing page naming the checkout
	 * the owner walked out of; releasing it here lets them choose again at
	 * once. The marker is dropped either way, so a reload does not replay it.
	 */
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
