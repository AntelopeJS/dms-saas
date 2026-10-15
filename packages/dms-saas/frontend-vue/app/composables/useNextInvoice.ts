import type { ApiReadOptions } from './useMountedData'

const NEXT_INVOICE_ENDPOINT = '/api/saas/tenant/upcoming-invoice'

/** The figures of Stripe's next-invoice preview that cards quote. */
export interface NextInvoiceSummary {
	totalMinorUnits: number | null
	currency: string | null
	billingDate: string | null
}

/**
 * Stripe's preview of the next invoice, shared by the cards quoting its total
 * (plan card, trial strip); the "Next invoice" block reads the full rows.
 * The trial strip reads it with `server: false` (see `useMountedData`).
 */
export function useNextInvoice(
	options: ApiReadOptions = {},
): ApiDataResult<NextInvoiceSummary> {
	return useApiData<NextInvoiceSummary>(NEXT_INVOICE_ENDPOINT, options)
}
