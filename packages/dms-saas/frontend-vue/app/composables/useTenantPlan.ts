import type { PlanInterval } from './usePlanIntervalLabel'

const TENANT_PLAN_ENDPOINT = '/api/saas/tenant/plan'
const TENANT_PLAN_STATE_KEY = 'saas-tenant-plan'
const TENANT_CHECKOUT_ENDPOINT = `${TENANT_PLAN_ENDPOINT}/checkout`
const TENANT_PREVIEW_ENDPOINT = `${TENANT_PLAN_ENDPOINT}/preview`
const TENANT_CANCELLATION_ENDPOINT = `${TENANT_PLAN_ENDPOINT}/cancellation`

/** Query parameter naming the checkout a Stripe cancel link belongs to. */
export const CHECKOUT_OPERATION_PARAM = 'checkoutOperation'

export type PlanBillingMode = 'flat' | 'seat'

export type PlanAudience = 'any' | 'individual' | 'business'

export interface TenantPlanFeature {
	featureId: string
	displayName: string
	tooltip: string | null
	unit: string | null
	valueType: 'boolean' | 'number' | 'string'
	isDetailRow: boolean
	order: number
}

export interface TenantPlanView {
	_id: string
	name: string
	price: number
	currency: string
	interval: PlanInterval
	order: number
	checkoutAvailable: boolean
	featureValues: Record<string, unknown>
}

/** A plan of the comparison, with what the owner needs to choose it. */
export interface OfferedPlanView extends TenantPlanView {
	description: string
	billingMode: PlanBillingMode
	/** Seat cap; negative (-1) for no cap, as the plan stores it. */
	maxMembers: number
	trialDays: number
	/** Whether choosing the plan now starts its trial. */
	isTrialOffered: boolean
	audience: PlanAudience
	/** Whether the plan is sold to the workspace's customer type. */
	isOfferedToCustomerType: boolean
}

export interface CurrentPlan {
	_id: string
	name: string
	description: string
	price: number
	currency: string
	interval: PlanInterval
	billingMode: PlanBillingMode
	maxMembers: number
	trialDays: number
}

export interface PendingPlanChange {
	planId: string
	planName: string
	effectiveAt: string | null
}

/** Seats the workspace holds: members and pending invitations each take one. */
export interface SeatsInUse {
	members: number
	pendingInvites: number
	occupied: number
}

export interface TenantPlanResponse {
	current: CurrentPlan | null
	seats: SeatsInUse
	available: OfferedPlanView[]
	features: TenantPlanFeature[]
	status: string | null
	freeUntil: string | null
	isComplimentary: boolean
	isPlanChangeLocked: boolean
	canRecoverComplimentary: boolean
	/** A cancelled workspace whose owner may choose a plan again to reopen it. */
	canResubscribe: boolean
	paidUsageStartedAt: string | null
	paidUsagePeriods: PaidUsagePeriod[] | null
	currentPeriodEnd: string | null
	pendingPlan: PendingPlanChange | null
}

export interface PaidUsagePeriod {
	stripeSubscriptionId: string
	start: string
	end: string | null
}

/** The payment the owner must authenticate before an upgrade applies. */
export interface UpgradeAuthentication {
	clientSecret: string
}

export interface ChangePlanResult {
	changed: boolean
	scheduled: boolean
	planId: string
	effectiveAt: string | null
	checkoutUrl: string | null
	/** Set when the upgrade waits on a 3D Secure challenge. */
	authentication: UpgradeAuthentication | null
}

/**
 * `upgrade` applies today, `downgrade` at renewal, `checkout` on Stripe,
 * `free` today with nothing billed.
 */
export type PlanChangeKind = 'upgrade' | 'downgrade' | 'checkout' | 'free'

export interface PlanChangeLine {
	description: string | null
	amountMinorUnits: number
	quantity: number | null
	periodStart: string
	periodEnd: string
	isProration: boolean
}

export interface PlanChangeTax {
	amountMinorUnits: number
	ratePercentage: number | null
	country: string | null
	isReverseCharge: boolean
}

/** The invoice Stripe issues for the change, priced before it applies. */
export interface PlanChangeCharge {
	currency: string
	lines: PlanChangeLine[]
	subtotalMinorUnits: number
	totalExcludingTaxMinorUnits: number
	taxMinorUnits: number
	taxes: PlanChangeTax[]
	totalMinorUnits: number
	amountDueMinorUnits: number
}

export interface PlanChangeRenewal {
	at: string | null
	amountExcludingTaxMinorUnits: number
	interval: PlanInterval
}

/** What changing to one plan costs, as `GET /plan/preview` prices it. */
export interface PlanChangePreview {
	kind: PlanChangeKind
	planId: string
	currency: string
	quantity: number
	effectiveAt: string | null
	isTrial: boolean
	trialEndsAt: string | null
	charge: PlanChangeCharge | null
	isChargeAvailable: boolean
	renewal: PlanChangeRenewal
	prorationDate: number | null
}

export interface CancellationResult {
	cancelAt: string | null
}

/** The Stripe Checkout a workspace is waiting on. */
export interface PendingCheckout {
	targetPlanId: string | null
	/** Where the owner resumes paying; null once nothing is left to pay. */
	checkoutUrl: string | null
	expiresAt: string | null
	/** Paid, and waiting for Stripe to confirm it. */
	isPaid: boolean
}

export interface PendingCheckoutResult {
	pending: PendingCheckout | null
}

export interface CancelCheckoutResult {
	released: boolean
}

function currentPageUrl(): string {
	return typeof window !== 'undefined' ? window.location.href : '/'
}

/** The payload resolves inheritance for every public plan and carries the
 * features catalogue, so the plan card and the free-access banner share it. */
export function useTenantPlan() {
	const { $authFetch } = useAuthFetch()
	const { authenticateUpgrade } = useUpgradeAuthentication()
	const shared = useSharedRequest(TENANT_PLAN_STATE_KEY, () =>
		$authFetch<TenantPlanResponse>(TENANT_PLAN_ENDPOINT),
	)

	/**
	 * `prorationDate` is the reviewed preview's, so the charge matches it. A
	 * card that asks for 3D Secure is challenged before this resolves.
	 */
	async function changePlan(
		planId: string,
		prorationDate?: number | null,
	): Promise<ChangePlanResult> {
		const returnUrl = currentPageUrl()
		const result = await $authFetch<ChangePlanResult>(TENANT_PLAN_ENDPOINT, {
			method: 'PUT',
			body: {
				planId,
				successUrl: returnUrl,
				cancelUrl: returnUrl,
				prorationDate: prorationDate ?? undefined,
			},
		})
		return result.authentication
			? authenticateUpgrade(planId, result.authentication)
			: result
	}

	/** `country` prices a first subscription before the identity is saved. */
	function previewChange(
		planId: string,
		country?: string | null,
	): Promise<PlanChangePreview> {
		return $authFetch<PlanChangePreview>(TENANT_PREVIEW_ENDPOINT, {
			query: country ? { planId, country } : { planId },
		})
	}

	function cancelPendingChange(): Promise<ChangePlanResult> {
		return $authFetch<ChangePlanResult>(`${TENANT_PLAN_ENDPOINT}/pending`, {
			method: 'DELETE',
		})
	}

	function cancelSubscription(): Promise<CancellationResult> {
		return $authFetch<CancellationResult>(TENANT_CANCELLATION_ENDPOINT, {
			method: 'POST',
		})
	}

	function keepSubscription(): Promise<CancellationResult> {
		return $authFetch<CancellationResult>(TENANT_CANCELLATION_ENDPOINT, {
			method: 'DELETE',
		})
	}

	function loadPendingCheckout(): Promise<PendingCheckoutResult> {
		return $authFetch<PendingCheckoutResult>(TENANT_CHECKOUT_ENDPOINT)
	}

	/** Without an operation id, gives up on whatever checkout is pending. */
	function cancelCheckout(operationId?: string): Promise<CancelCheckoutResult> {
		return $authFetch<CancelCheckoutResult>(TENANT_CHECKOUT_ENDPOINT, {
			method: 'DELETE',
			query: operationId ? { [CHECKOUT_OPERATION_PARAM]: operationId } : {},
		})
	}

	return {
		...shared,
		changePlan,
		previewChange,
		cancelPendingChange,
		cancelSubscription,
		keepSubscription,
		loadPendingCheckout,
		cancelCheckout,
	}
}
