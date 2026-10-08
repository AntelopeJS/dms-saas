import type {
	OfferedPlanView,
	SeatsInUse,
	TenantPlanFeature,
} from './useTenantPlan'

/** Query parameter naming the plan to review on arrival on the billing page. */
export const UPGRADE_QUERY_PARAM = 'upgrade'

const UNLIMITED_VALUE = -1
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

/** Plans the workspace may move to, and those its seats rule out. */
export interface OfferedPlans {
	offered: OfferedPlanView[]
	tooSmall: OfferedPlanView[]
}

/**
 * The plan id an arrival link asks to review (`?upgrade=<planId>`), or null.
 * A repeated parameter takes its first non-empty value.
 */
export function readUpgradeParam(
	query: Record<string, unknown> | null | undefined,
): string | null {
	const raw = query?.[UPGRADE_QUERY_PARAM]
	const values = Array.isArray(raw) ? raw : [raw]
	const planId = values.find(
		(value): value is string =>
			typeof value === 'string' && value.trim().length > 0,
	)
	return planId?.trim() ?? null
}

/** Whether a plan's seat cap holds the seats in use (negative means no cap). */
export function fitsSeats(plan: OfferedPlanView, seats: SeatsInUse): boolean {
	return plan.maxMembers <= UNLIMITED_VALUE || plan.maxMembers >= seats.occupied
}

/**
 * The plans offered in the comparison: those the seats in use fit, the
 * current one always; the rest are named apart, with why they are not offered.
 */
export function splitOfferedPlans(
	plans: OfferedPlanView[],
	seats: SeatsInUse,
	currentPlanId: string | null,
): OfferedPlans {
	const isOffered = (plan: OfferedPlanView) =>
		plan._id === currentPlanId || fitsSeats(plan, seats)
	return {
		offered: plans.filter(isOffered),
		tooSmall: plans.filter((plan) => !isOffered(plan)),
	}
}

/**
 * How much of a feature a value grants: not included (absent, `false`, 0),
 * a limit (its number), unlimited (−1), included (`true`). Text values have
 * no order and rank as included.
 */
export function featureRank(value: unknown): number {
	if (value === undefined || value === null || value === false) return 0
	if (value === true) return 1
	if (typeof value === 'number') {
		return value === UNLIMITED_VALUE ? UNLIMITED_RANK : Math.max(value, 0)
	}
	return typeof value === 'string' && value.trim() ? 1 : 0
}

/** The features gained and lost when moving from one plan to another. */
export function diffPlanFeatures(
	features: TenantPlanFeature[],
	from: OfferedPlanView | null,
	to: OfferedPlanView,
): PlanFeatureDiff {
	const diff: PlanFeatureDiff = { gained: [], lost: [] }
	for (const feature of features) {
		const before = from?.featureValues[feature.featureId]
		const after = to.featureValues[feature.featureId]
		const delta = featureRank(after) - featureRank(before)
		if (delta === 0) continue
		const change = { feature, from: before, to: after }
		;(delta > 0 ? diff.gained : diff.lost).push(change)
	}
	return diff
}
