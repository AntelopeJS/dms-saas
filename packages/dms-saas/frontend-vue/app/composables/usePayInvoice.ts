const PAY_INVOICE_STATE_KEY = 'saas-pay-invoice'

/** The invoice the pay dialog is open on. */
export interface PayableInvoice {
	invoiceId: string
	number: string | null
	/** Minor units, as Stripe bills it. */
	amount: number
	currency: string
	hostedInvoiceUrl: string | null
}

export interface PayInvoiceResult {
	status: string | null
}

const PAID_STATUS = 'paid'

/** Whether Stripe reports the invoice settled after the attempt. */
export function isInvoiceSettled(result: PayInvoiceResult): boolean {
	return result.status === PAID_STATUS
}

/**
 * The pay-invoice dialog, opened from the past-due alert, the layout strip or
 * an invoice row: its target is shared so one dialog serves them all.
 */
export function usePayInvoice() {
	const { $authFetch } = useAuthFetch()
	const target = useDmsState<PayableInvoice | null>(
		PAY_INVOICE_STATE_KEY,
		() => null,
	)

	function open(invoice: PayableInvoice): void {
		target.value = invoice
	}

	function close(): void {
		target.value = null
	}

	/** Charges the default card on file for the invoice. */
	function payWithDefaultCard(invoiceId: string): Promise<PayInvoiceResult> {
		return $authFetch<PayInvoiceResult>(
			`/api/saas/billing/invoices/${encodeURIComponent(invoiceId)}/pay`,
			{ method: 'POST' },
		)
	}

	return { target, open, close, payWithDefaultCard }
}
