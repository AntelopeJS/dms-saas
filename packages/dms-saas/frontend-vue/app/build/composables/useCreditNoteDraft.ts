import { computed, ref, type Ref } from 'vue'
import { fromMinorUnits, toMinorUnits } from '../../composables/useMoneyFormat'

/** How a credit note reaches the customer, as the server names it. */
export type CreditMode = 'credit_to_balance' | 'refund' | 'reduce_amount_due'

/** Why an invoice cannot be credited. */
export type CreditBlockReason =
	| 'draft'
	| 'void'
	| 'uncollectible'
	| 'fully_credited'

export interface PreviewLine {
	description: string
	quantity: number | null
	amount: number
	currency?: string | null
	periodStart: string | null
	periodEnd: string | null
}

export interface PriorCredit {
	number: string
	amount: number
	currency: string
	type: string
	status: string
	issuedAt: string
}

export interface PaymentCard {
	brand: string
	last4: string
}

/** The invoice a credit note is written against. */
export interface PreviewInvoice {
	_id: string
	number: string | null
	status: string
	currency: string
	total: number
	tax: number
	amountPaid: number
	paidAt: string | null
	autoFinalizesAt: string | null
	lines: PreviewLine[]
}

/** What `GET /api/saas/credit-notes/preview/:invoiceId` answers. */
export interface CreditNotePreview {
	credited: number
	creditable: number
	modes: CreditMode[]
	blockReason: CreditBlockReason | null
	workspaceName: string
	priorCredits: PriorCredit[]
	card: PaymentCard | null
	nextInvoiceAt: string | null
	invoice: PreviewInvoice
}

/** The reasons an operator picks from, as the server names them. */
export const CREDIT_REASONS = [
	'service_issue',
	'billing_error',
	'duplicate',
	'goodwill',
	'fraudulent',
	'other',
] as const

export type CreditReason = (typeof CREDIT_REASONS)[number]

/** The longest internal memo Stripe keeps. */
export const INTERNAL_MEMO_MAX_LENGTH = 500

/**
 * The state of a credit note being written against a loaded preview: the mode,
 * the amount in major units and its minor-unit twin, the ceiling check.
 */
export function useCreditNoteDraft(preview: Ref<CreditNotePreview | null>) {
	const mode = ref<CreditMode | undefined>(undefined)
	const amount = ref<number | null>(null)
	const reason = ref<CreditReason | undefined>(undefined)
	const memo = ref('')

	const currency = computed(() => preview.value?.invoice.currency ?? 'eur')
	const creditable = computed(() => preview.value?.creditable ?? 0)
	const creditableMajor = computed(() =>
		fromMinorUnits(creditable.value, currency.value),
	)
	const amountMinor = computed(() =>
		typeof amount.value === 'number'
			? toMinorUnits(amount.value, currency.value)
			: 0,
	)
	const isAboveCeiling = computed(() => amountMinor.value > creditable.value)
	const isMemoTooLong = computed(
		() => memo.value.trim().length > INTERNAL_MEMO_MAX_LENGTH,
	)
	const canSubmit = computed(
		() =>
			!!mode.value &&
			!!reason.value &&
			amountMinor.value > 0 &&
			!isAboveCeiling.value &&
			!isMemoTooLong.value,
	)
	/** What the invoice will have been credited in all once this note is out. */
	const creditedAfter = computed(
		() => (preview.value?.credited ?? 0) + amountMinor.value,
	)

	function reset(next: CreditNotePreview | null): void {
		mode.value = next?.modes[0]
		amount.value = null
		reason.value = undefined
		memo.value = ''
	}

	function useMax(): void {
		amount.value = creditableMajor.value
	}

	return {
		mode,
		amount,
		reason,
		memo,
		currency,
		creditable,
		amountMinor,
		isAboveCeiling,
		isMemoTooLong,
		canSubmit,
		creditedAfter,
		reset,
		useMax,
	}
}
