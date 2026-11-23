import { isRecord, isText } from '../build/type-guards'
import type {
	OfferedPlanView,
	SeatsInUse,
	TenantPlanFeature,
} from './useTenantPlan'
import {
	isFeatureNumber,
	isFeatureText,
	isPlanFeatureValue,
	PLAN_UNLIMITED,
	type PlanFeatureValue,
} from '../build/plan-catalog'
import { isApiFailure } from './useApiErrorMessage'

/** Query parameter naming the plan to review on arrival on the billing page. */
export const UPGRADE_QUERY_PARAM = 'upgrade'

const INCOMPATIBLE_CODE = 'saas.errors.plan.incompatible'

const UNLIMITED_RANK = Number.POSITIVE_INFINITY

/** One feature that differs between two plans. */
export interface PlanFeatureChange {
	feature: TenantPlanFeature
	from: unknown
	to: unknown
}

/** What moving between two plans gives and takes away. */
export interface PlanFeatureDiff {
	gained: PlanFeatureChange[]
	lost: PlanFeatureChange[]
}

/**
 * Plans the workspace may move to, those reserved to the other customer type,
 * and those its seats rule out.
 */
export interface OfferedPlans {
	offered: OfferedPlanView[]
	forOtherCustomerType: OfferedPlanView[]
	tooSmall: OfferedPlanView[]
}

/** Where the checkout dialog stands before it may send the owner to pay. */
export interface CheckoutReadiness {
	isLoading: boolean
	hasLoadFailed: boolean
	/** Translated reason the preview was refused, null once it priced. */
	previewFailure: string | null
}

/**
 * Whether the checkout dialog may offer the payment page: the identity is
 * loaded and the plan change was not refused while previewed — the checkout
 * itself would refuse it for the same reason.
 */
export function canContinueToCheckout(readiness: CheckoutReadiness): boolean {
	return (
		!readiness.isLoading &&
		!readiness.hasLoadFailed &&
		readiness.previewFailure === null
	)
}

/** Something the workspace holds that the target plan does not allow. */
export interface PlanChangeIncompatibility {
	code: string
	message: string
	resource?: string
}

/** Something the plan-change policy asks the owner to read; it never blocks. */
export interface PlanChangeNotice {
	code: string
	message: string
	resource?: string
}

function isIncompatibility(value: unknown): value is PlanChangeIncompatibility {
	return (
		isRecord(value) &&
		isText(value.code) &&
		isText(value.message) &&
		(value.resource === undefined || isText(value.resource))
	)
}

function readIncompatibilities(
	data: unknown,
): PlanChangeIncompatibility[] | null {
	if (isRecord(data)) {
		const list = data.incompatibilities
		return data.code === INCOMPATIBLE_CODE &&
			Array.isArray(list) &&
			list.every(isIncompatibility)
			? list
			: null
	}
	return null
}

/**
 * What the workspace must bring within the target plan before it can move,
 * read from the 409 a plan change preview or confirmation answers with; null
 * for any other failure.
 */
export function readPlanChangeIncompatibilities(
	error: unknown,
): PlanChangeIncompatibility[] | null {
	return isApiFailure(error) ? readIncompatibilities(error.data) : null
}

/** The query of the page, as the router hands it over. */
type UpgradeQuery = Record<
	string,
	string | null | undefined | (string | null)[]
>

/**
 * The plan id an arrival link asks to review (`?upgrade=<planId>`), or null.
 * A repeated parameter takes its first non-empty value.
 */
export function readUpgradeParam(
	query: UpgradeQuery | null | undefined,
): string | null {
	const raw = query?.[UPGRADE_QUERY_PARAM]
	const values: (string | null | undefined)[] = Array.isArray(raw) ? raw : [raw]
	const planId = values.find(
		(value): value is string =>
			typeof value === 'string' && value.trim().length > 0,
	)
	return planId?.trim() ?? null
}

/** Whether a plan's seat cap holds the seats in use (negative means no cap). */
export function fitsSeats(plan: OfferedPlanView, seats: SeatsInUse): boolean {
	return plan.maxMembers <= PLAN_UNLIMITED || plan.maxMembers >= seats.occupied
}

/**
 * The plans offered in the comparison: those sold to the customer type that
 * the seats in use fit, the current one always; the rest are named apart,
 * with why they are not offered. The plan change refuses them anyway.
 */
export function splitOfferedPlans(
	plans: OfferedPlanView[],
	seats: SeatsInUse,
	currentPlanId: string | null,
): OfferedPlans {
	const others = plans.filter((plan) => plan._id !== currentPlanId)
	const forOtherCustomerType = others.filter(
		(plan) => !plan.isOfferedToCustomerType,
	)
	const tooSmall = others.filter(
		(plan) => plan.isOfferedToCustomerType && !fitsSeats(plan, seats),
	)
	const excluded = new Set([...forOtherCustomerType, ...tooSmall])
	return {
		offered: plans.filter((plan) => !excluded.has(plan)),
		forOtherCustomerType,
		tooSmall,
	}
}

function rankOfValue(value: PlanFeatureValue): number {
	if (value === null || value === false) return 0
	if (value === true) return 1
	if (isFeatureNumber(value)) {
		return value === PLAN_UNLIMITED ? UNLIMITED_RANK : Math.max(value, 0)
	}
	return isFeatureText(value) && value.trim() ? 1 : 0
}

/**
 * How much of a feature a value grants: not included (absent, `false`, 0),
 * a limit (its number), unlimited (−1), included (`true`). Text values have
 * no order and rank as included.
 */
export function featureRank(value: unknown): number {
	return isPlanFeatureValue(value) ? rankOfValue(value) : 0
}

/**
 * The features gained and lost when moving from one plan to another. Ranks
 * are compared, not subtracted: two unlimited values are both Infinity, and
 * Infinity - Infinity is NaN, which read as a loss.
 */
export function diffPlanFeatures(
	features: TenantPlanFeature[],
	from: OfferedPlanView | null,
	to: OfferedPlanView,
): PlanFeatureDiff {
	const diff: PlanFeatureDiff = { gained: [], lost: [] }
	for (const feature of features) {
		const before = from?.featureValues[feature.featureId]
		const after = to.featureValues[feature.featureId]
		const rankBefore = featureRank(before)
		const rankAfter = featureRank(after)
		if (rankAfter === rankBefore) continue
		const change = { feature, from: before, to: after }
		;(rankAfter > rankBefore ? diff.gained : diff.lost).push(change)
	}
	return diff
}
