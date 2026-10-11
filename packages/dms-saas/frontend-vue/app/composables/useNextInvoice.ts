const NEXT_INVOICE_ENDPOINT = '/api/saas/tenant/upcoming-invoice'
const NEXT_INVOICE_STATE_KEY = 'saas-next-invoice'

/** The figures of Stripe's next-invoice preview that cards quote. */
export interface NextInvoiceSummary {
	totalMinorUnits: number | null
	currency: string | null
	billingDate: string | null
}

/**
 * Stripe's preview of the next invoice, shared by the cards quoting its total
 * (plan card, trial strip); the "Next invoice" block reads the full rows.
 */
export function useNextInvoice(): SharedRequest<NextInvoiceSummary> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(NEXT_INVOICE_STATE_KEY, () =>
		$authFetch<NextInvoiceSummary>(NEXT_INVOICE_ENDPOINT),
	)
}
