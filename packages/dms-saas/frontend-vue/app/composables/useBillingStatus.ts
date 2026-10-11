const BILLING_STATUS_ENDPOINT = '/api/saas/billing/status'
const BILLING_STATUS_STATE_KEY = 'saas-billing-status'

export interface PaymentMethodSummary {
	brand: string
	last4: string
	expMonth: number
	expYear: number
	holderName?: string | null
}

export interface UnpaidInvoiceRef {
	number: string | null
	amount: number
	currency: string
	hostedInvoiceUrl: string | null
}

export interface UnpaidInvoiceSummary extends UnpaidInvoiceRef {
	/** Row the pay-invoice request names. */
	invoiceId: string
	failedAt: string | null
	nextRetryAt: string | null
	suspendAt: string | null
}

/** Who members are told to ask. */
export interface WorkspaceOwnerContact {
	name: string
	email: string
}

export interface BillingStatusResponse {
	hasStripeCustomer: boolean
	status: string | null
	isTenantOwner: boolean
	workspaceOwner: WorkspaceOwnerContact | null
	paymentMethod: PaymentMethodSummary | null
	unpaidInvoice: UnpaidInvoiceSummary | null
	/** When the subscription stops on its own; null while it renews. */
	scheduledCancellationAt: string | null
}

/** Read by most billing blocks and the past-due banner; each call reaches
 * Stripe, so they share one request. */
export function useBillingStatus(): SharedRequest<BillingStatusResponse> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(BILLING_STATUS_STATE_KEY, () =>
		$authFetch<BillingStatusResponse>(BILLING_STATUS_ENDPOINT),
	)
}

const CARD_EXPIRY_YEAR_MODULO = 100
const CARD_EXPIRY_PAD = 2
const CARD_MASK = '••••'

/** "Visa •••• 4242". */
export function formatCardLabel(card: PaymentMethodSummary): string {
	const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
	return `${brand} ${CARD_MASK} ${card.last4}`
}

/** "04/27". */
export function formatCardExpiry(card: PaymentMethodSummary): string {
	const month = String(card.expMonth).padStart(CARD_EXPIRY_PAD, '0')
	const year = String(card.expYear % CARD_EXPIRY_YEAR_MODULO).padStart(
		CARD_EXPIRY_PAD,
		'0',
	)
	return `${month}/${year}`
}
