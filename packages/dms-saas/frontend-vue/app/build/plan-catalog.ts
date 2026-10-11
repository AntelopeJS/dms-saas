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
	/** What the editor preselects for a new plan: every permission. */
	newPlanPermissions: string[]
}

export const PLANS_ENDPOINT = '/api/saas/plans'
export const PLANS_PAGE_URL = '/modules/saas/catalog/plans'
const MONTHS_PER_YEAR = 12
/** A member cap or feature limit no workspace reaches. */
export const PLAN_UNLIMITED = -1
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
	if (typeof value === 'number') return value === PLAN_UNLIMITED || value > OFF
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

/** One entry of the plan menu, as the table serializes it for the cards. */
export interface PlanCardAction {
	/** Names the entry a card control stands for (`stop_selling`, `retire`). */
	id?: string
	label: string
	icon?: string
	color?: string
	target: { type: string }
	rule?: RowActionRule
}

/** The table's row actions a plan card runs, as the cards display hands them. */
export interface PlanCardTableActions {
	canEditRow: (row: CatalogPlanRow) => boolean
	edit: (row: CatalogPlanRow) => void
	/** Runs a menu entry through the table: confirmation, request, refresh. */
	custom: (action: PlanCardAction, row: CatalogPlanRow) => void
	/** The plan's menu entries, the table's custom row actions its rules allow. */
	customFor: (row: CatalogPlanRow) => PlanCardAction[]
}

/** A card's move handle, as the cards display of a hand-ordered table hands it. */
export interface PlanCardReorder {
	enabled: boolean
	dragging: boolean
	/** Attributes and listeners to bind on the handle button. */
	handle: Record<string, unknown>
}

/** The plan fields a catalogue card's price reads. */
export interface CardPricedPlan {
	price: number
	interval: string
	billingMode: string
}

/**
 * The i18n key of what follows a card's amount: "per seat / month", "per
 * year", or "forever" for a free plan.
 */
export function cardPriceSuffixKey(plan: CardPricedPlan): string {
	if (plan.price === 0) return 'saas.catalog.plans.card.forever'
	const key = plan.billingMode === 'seat' ? 'per_seat' : 'per'
	return `saas.catalog.plans.card.${key}_${plan.interval}`
}
