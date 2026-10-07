import { formatMajorUnits } from '../composables/useMoneyFormat'

/** A plan row of the catalogue table, as the cards read it. */
export interface CatalogPlanRow {
	_id: string
	name: string
	description: string | null
	audience: 'any' | 'individual' | 'business'
	price: number
	currency: string
	interval: 'month' | 'year'
	billingMode: 'flat' | 'seat'
	trialDays: number
	maxMembers: number
	isActive: boolean
	isPublic: boolean
	order: number
	borderLabel: string | null
	borderColor: string | null
	workspaceCount: number
	payingCount: number
	trialingCount: number
	seatCount: number
	memberCount: number
	mrr: number
	mrrShare: number
	resolvedFeatures: CatalogFeatureValue[]
	stripeProductId: string | null
	stripeProductUrl: string | null
	updatedAt: string | null
}

/** A feature value a plan resolves (its own or its parent's). */
export interface CatalogFeatureValue {
	featureId: string
	value: unknown
}

/** A feature of the catalogue, as `/api/saas/plans/catalog` lists it. */
export interface CatalogFeature {
	_id: string
	displayName: string
	description: string
	tooltip: string | null
	valueType: 'boolean' | 'number' | 'string'
	unit: string | null
	isDetailRow: boolean
	order: number
}

/** A plan another can build on, as `/api/saas/plans/catalog` lists it. */
export interface CatalogParentPlan {
	_id: string
	name: string
	inheritsFromPlanId: string | null
	permissions: string[]
	features: CatalogFeatureValue[]
}

/** What `/api/saas/plans/catalog` answers. */
export interface PlanCatalog {
	plans: CatalogParentPlan[]
	features: CatalogFeature[]
}

export const PLANS_ENDPOINT = '/api/saas/plans'
export const PLANS_PAGE_URL = '/modules/saas/catalog/plans'
const MONTHS_PER_YEAR = 12
const UNLIMITED = -1
const OFF = 0

/** A plan's price in its currency, whole amounts without decimals. */
export function formatPlanAmount(
	amount: number,
	currency: string,
	locale: string,
): string {
	return formatMajorUnits(amount, currency, locale, {
		hideWholeAmountDecimals: true,
	})
}

/** What a yearly plan costs per month, for the "≈ €69 / month" note. */
export function monthlyEquivalent(
	plan: Pick<CatalogPlanRow, 'price' | 'interval'>,
): number {
	return plan.interval === 'year' ? plan.price / MONTHS_PER_YEAR : plan.price
}

/** Whether a resolved feature value reads as included (on, a limit, unlimited). */
export function isFeatureIncluded(value: unknown): boolean {
	if (typeof value === 'number') return value === UNLIMITED || value > OFF
	if (typeof value === 'string') return value.trim().length > 0
	return value === true
}

/** The features a card lists: the main rows, included first, in order. */
export function cardFeatures(
	features: CatalogFeature[],
	values: CatalogFeatureValue[],
	limit: number,
): Array<{ feature: CatalogFeature; value: unknown; isIncluded: boolean }> {
	const byId = new Map(values.map((entry) => [entry.featureId, entry.value]))
	return features
		.filter((feature) => !feature.isDetailRow)
		.map((feature) => {
			const value = byId.get(feature._id)
			return { feature, value, isIncluded: isFeatureIncluded(value) }
		})
		.sort((left, right) => Number(right.isIncluded) - Number(left.isIncluded))
		.slice(0, limit)
}

/** A row rule of the plan menu: a field equal, or not, to a value. */
export interface PlanActionRule {
	field: string
	equals?: unknown
	notEquals?: unknown
}

/** One entry of the plan menu, as the table serializes it for the cards. */
export interface PlanCardAction {
	key: string
	label: string
	icon?: string
	color?: string
	target: { type: string }
	rule?: PlanActionRule
}

/** Whether a menu entry applies to a plan, as the table's rule decides. */
export function isActionAllowed(
	action: Pick<PlanCardAction, 'rule'>,
	plan: Record<string, unknown>,
): boolean {
	const rule = action.rule
	if (!rule) return true
	const value = plan[rule.field] ?? null
	if ('equals' in rule) return value === rule.equals
	if ('notEquals' in rule) return value !== rule.notEquals
	return true
}

/**
 * New `order` values for rows moved by hand: the moved rows take the
 * positions the shown rows held, in their new sequence, so rows hidden by a
 * tab or a search keep theirs.
 */
export function reorderPositions<T extends { _id: string; order: number }>(
	shown: T[],
	moved: T[],
): Array<{ id: string; order: number }> {
	const sorted = shown.map((row) => row.order ?? 0).sort((a, b) => a - b)
	const isStrict = sorted.every(
		(value, index) => index === 0 || value > sorted[index - 1]!,
	)
	// Equal positions (plans never ordered) leave no room: renumber from the lowest.
	const positions = isStrict
		? sorted
		: sorted.map((_, index) => (sorted[0] ?? 0) + index)
	return moved
		.map((row, index) => ({ id: row._id, order: positions[index] ?? index }))
		.filter((item, index) => item.order !== moved[index]?.order)
}
