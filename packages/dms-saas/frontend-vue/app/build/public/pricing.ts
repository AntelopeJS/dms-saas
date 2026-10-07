import type { PlanInterval } from '../../composables/usePlanIntervalLabel'
import type { TenantPlanFeature } from '../../composables/useTenantPlan'

export type PlanBillingMode = 'flat' | 'seat'
export type RefundMode = 'full' | 'prorated'

/** A public plan, as `/api/saas/pricing` and `/api/saas/register/plan` send it. */
export interface PublicPlan {
	_id: string
	slug: string
	name: string
	description: string
	/** Major units, per interval (and per member for `seat`). */
	price: number
	currency: string
	interval: PlanInterval
	billingMode: PlanBillingMode
	trialDays: number
	/** -1 means unlimited members. */
	maxMembers: number
	borderColor: string | null
	borderLabel: string | null
	order: number
	inheritsFromPlanId: string | null
	featureValues: Record<string, unknown>
}

export interface PublicMoneyBackGuarantee {
	windowDays: number
	mode: RefundMode
}

export interface PublicBillingRules {
	moneyBackGuarantee: PublicMoneyBackGuarantee | null
	dataRetentionDays: number
	maxFreeWorkspacesPerCard: number
}

export interface PublicPricing {
	plans: PublicPlan[]
	features: TenantPlanFeature[]
	rules: PublicBillingRules
	defaultPlanId: string | null
}

/** What the sign-up screens show about the plan they open the workspace on. */
export interface RegistrationPlanSummary {
	plan: PublicPlan
	requestedPlan: PublicPlan | null
	features: TenantPlanFeature[]
	rules: PublicBillingRules
}

export interface SeatExample {
	seats: number
	total: number
}

export interface FeatureHighlight {
	feature: TenantPlanFeature
	value: unknown
}

export interface ComparisonRows {
	main: TenantPlanFeature[]
	detail: TenantPlanFeature[]
}

const UNLIMITED_MEMBERS = -1
/** Team size the per-seat price is worked out for, under the plan's cap. */
const EXAMPLE_SEATS = 10
const INTERVAL_ORDER: PlanInterval[] = ['month', 'year']
const NOT_INCLUDED_VALUES = new Set<unknown>([
	0,
	false,
	'',
	'false',
	null,
	undefined,
])

export function isPaidPlan(plan: PublicPlan): boolean {
	return plan.price > 0
}

/** What a sign-up link names the plan by: its slug, else its id. */
export function planReference(plan: PublicPlan): string {
	return plan.slug || plan._id
}

/** 0 / false / empty mean "not included"; −1 and every other value do not. */
export function isIncludedValue(value: unknown): boolean {
	return !NOT_INCLUDED_VALUES.has(value)
}

/**
 * The intervals paid plans are sold in, in a stable order. The interval
 * toggle shows only when there are two of them: a free plan costs the same
 * either way and does not count.
 */
export function paidIntervals(plans: PublicPlan[]): PlanInterval[] {
	const sold = new Set(plans.filter(isPaidPlan).map((plan) => plan.interval))
	return INTERVAL_ORDER.filter((interval) => sold.has(interval))
}

/** The plans shown for an interval: those billed on it, and the free ones. */
export function plansForInterval(
	plans: PublicPlan[],
	interval: PlanInterval,
): PublicPlan[] {
	return plans
		.filter((plan) => !isPaidPlan(plan) || plan.interval === interval)
		.sort((left, right) => left.order - right.order)
}

/**
 * A worked example of a per-member price: what a team of ten pays, or a full
 * team when the plan caps members below ten. Null for a flat price.
 */
export function seatExample(plan: PublicPlan): SeatExample | null {
	if (plan.billingMode !== 'seat' || !isPaidPlan(plan)) return null
	const isCapped = plan.maxMembers !== UNLIMITED_MEMBERS && plan.maxMembers > 0
	const seats = isCapped
		? Math.min(EXAMPLE_SEATS, plan.maxMembers)
		: EXAMPLE_SEATS
	return { seats, total: plan.price * seats }
}

/** The plan `plan` extends, when that one is shown next to it. */
export function findParentPlan(
	plan: PublicPlan,
	shown: PublicPlan[],
): PublicPlan | null {
	if (!plan.inheritsFromPlanId) return null
	return shown.find((entry) => entry._id === plan.inheritsFromPlanId) ?? null
}

/**
 * The main features a plan card lists: those it includes, and when it
 * extends a plan shown beside it, only those it improves on.
 */
export function featureHighlights(
	plan: PublicPlan,
	parent: PublicPlan | null,
	features: TenantPlanFeature[],
): FeatureHighlight[] {
	return features
		.filter((feature) => !feature.isDetailRow)
		.map((feature) => ({
			feature,
			value: plan.featureValues[feature.featureId],
		}))
		.filter(({ value }) => isIncludedValue(value))
		.filter(
			({ feature, value }) =>
				!parent || parent.featureValues[feature.featureId] !== value,
		)
}

/** Comparison rows in catalogue order, main rows first. */
export function splitComparisonRows(
	features: TenantPlanFeature[],
): ComparisonRows {
	const ordered = [...features].sort((left, right) => left.order - right.order)
	return {
		main: ordered.filter((feature) => !feature.isDetailRow),
		detail: ordered.filter((feature) => feature.isDetailRow),
	}
}

/** One currency for every plan shown, or null when they differ. */
export function sharedCurrency(plans: PublicPlan[]): string | null {
	const currencies = new Set(plans.map((plan) => plan.currency.toUpperCase()))
	return currencies.size === 1 ? [...currencies][0]! : null
}
