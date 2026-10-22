/**
 * Which words head a plan change: "Upgrade" only fits a plan that costs
 * more, paid now. A plan at the same price is a switch, a change during a
 * trial charges nothing today, and a cancelled workspace choosing a plan
 * again resubscribes — through Checkout for a paid plan, through the review
 * for a free one.
 */

/** What the review step of a plan change is titled after. */
export type PlanChangeHeadingCase =
	| 'resubscribe'
	| 'free'
	| 'downgrade'
	| 'trial'
	| 'same_price'
	| 'upgrade'

/** What the checkout dialog of a first paid plan is titled after. */
export type CheckoutHeadingCase = 'resubscribe' | 'trial' | 'upgrade'

/** The part of a plan its price compares on. */
export interface ComparablePlanPrice {
	price: number
	interval: string
	billingMode: string
}

/** The part of a priced change the heading reads. */
export interface PricedChange {
	kind: string
	isTrial: boolean
}

const KINDS_NAMED_BY_THEMSELVES = new Set(['free', 'downgrade'])

function costsTheSame(
	current: ComparablePlanPrice | null,
	target: ComparablePlanPrice,
): boolean {
	return (
		!!current &&
		current.price === target.price &&
		current.interval === target.interval &&
		current.billingMode === target.billingMode
	)
}

/**
 * The heading of a plan change's review, once Stripe priced it.
 *
 * @param change The priced change, null while it is being priced
 * @param current The plan in force
 * @param target The plan chosen
 * @param isResubscription The workspace was cancelled and comes back
 */
export function planChangeHeadingCase(
	change: PricedChange | null,
	current: ComparablePlanPrice | null,
	target: ComparablePlanPrice,
	isResubscription = false,
): PlanChangeHeadingCase {
	if (isResubscription) return 'resubscribe'
	if (change && KINDS_NAMED_BY_THEMSELVES.has(change.kind))
		return change.kind as PlanChangeHeadingCase
	if (change?.isTrial) return 'trial'
	return costsTheSame(current, target) ? 'same_price' : 'upgrade'
}

/**
 * The heading of the checkout dialog that opens a paid subscription.
 *
 * @param isResubscription The workspace was cancelled and comes back
 * @param isTrial The plan starts with a trial, so nothing is due today
 */
export function checkoutHeadingCase(
	isResubscription: boolean,
	isTrial: boolean,
): CheckoutHeadingCase {
	if (isResubscription) return 'resubscribe'
	return isTrial ? 'trial' : 'upgrade'
}

/** When the chosen plan starts, as its card in the review says it. */
export type TargetPlanEyebrow = 'from_today' | 'from_date'

/**
 * The eyebrow of the chosen plan's card: from today, or from the renewal for
 * a downgrade; none until the change is priced, and none for a change the
 * workspace does not fit, which starts on no date at all.
 *
 * @param change The priced change, null while it is priced or once refused
 * @param isRefused The workspace holds more than the chosen plan allows
 */
export function targetPlanEyebrow(
	change: PricedChange | null,
	isRefused: boolean,
): TargetPlanEyebrow | null {
	if (isRefused || !change) return null
	return change.kind === 'downgrade' ? 'from_date' : 'from_today'
}
