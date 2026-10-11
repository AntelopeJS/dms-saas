const OPEN_STATE_KEY = 'saas-plan-comparison-open'
const REVIEW_STATE_KEY = 'saas-plan-comparison-review'

/**
 * The plan change dialog hosted by the plan card, shared so other billing
 * blocks (the payment method card) can open it: on Compare, or straight on
 * the Review of one plan.
 */
export function usePlanComparison() {
	const isOpen = useDmsState<boolean>(OPEN_STATE_KEY, () => false)
	const reviewPlanId = useDmsState<string | null>(REVIEW_STATE_KEY, () => null)

	function open(): void {
		reviewPlanId.value = null
		isOpen.value = true
	}

	function openReview(planId: string): void {
		reviewPlanId.value = planId
		isOpen.value = true
	}

	return { isOpen, reviewPlanId, open, openReview }
}
