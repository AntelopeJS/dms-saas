import { computed, type Ref } from 'vue'
import type {
	CreditMode,
	CreditNotePreview,
	PaymentCard,
} from './useCreditNoteDraft'

const TEXT = 'saas.operator_billing.credit_modal'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

/** What the credit note dialog writes from a draft. */
export interface CreditNoteTextInput {
	preview: Ref<CreditNotePreview | null>
	mode: Ref<CreditMode | undefined>
	amountMinor: Ref<number>
	creditedAfter: Ref<number>
}

/** "Visa •••• 4242". */
export function cardLabel(card: PaymentCard): string {
	const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
	return `${brand} •••• ${card.last4}`
}

/** The sentences of the credit note dialog, in the reader's language. */
export function useCreditNoteTexts(input: CreditNoteTextInput) {
	const { t, locale } = useI18n()
	const { formatMinorUnits } = useMoneyFormat()

	const currency = computed(() => input.preview.value?.invoice.currency)
	const money = (amount: number) => formatMinorUnits(amount, currency.value)
	const day = (value: string | null | undefined) =>
		formatDate(value, locale.value, DAY_FORMAT) ?? ''
	const card = computed(() => {
		const paymentCard = input.preview.value?.card
		return paymentCard ? cardLabel(paymentCard) : t(`${TEXT}.card_unknown`)
	})
	const invoiceNumber = computed(
		() => input.preview.value?.invoice.number ?? '—',
	)
	const amount = computed(() => money(input.amountMinor.value))
	const nextInvoice = computed(() => {
		const date = day(input.preview.value?.nextInvoiceAt)
		return date
			? t(`${TEXT}.next_invoice_on`, { date })
			: t(`${TEXT}.next_invoice`)
	})

	const subtitle = computed(() => {
		const preview = input.preview.value
		if (!preview) return ''
		const params = {
			number: invoiceNumber.value,
			workspace: preview.workspaceName,
			date: day(preview.invoice.paidAt),
			card: card.value,
		}
		if (preview.invoice.status !== 'paid') {
			return t(`${TEXT}.subtitle_unpaid`, params)
		}
		return t(`${TEXT}.subtitle_paid`, params)
	})

	const modeItems = computed(() =>
		(input.preview.value?.modes ?? []).map((mode) => ({
			value: mode,
			label: t(`${TEXT}.mode.${mode}`),
			description: t(`${TEXT}.mode.${mode}_description`, {
				card: card.value,
				nextInvoice: nextInvoice.value,
			}),
		})),
	)

	const outcomeParams = computed(() => {
		const preview = input.preview.value
		const left = (preview?.creditable ?? 0) - input.amountMinor.value
		return {
			workspace: preview?.workspaceName ?? '',
			amount: amount.value,
			nextInvoice: nextInvoice.value,
			card: card.value,
			number: invoiceNumber.value,
			before: money(preview?.creditable ?? 0),
			remaining: money(Math.max(0, left)),
			credited: money(input.creditedAfter.value),
			total: money(preview?.invoice.total ?? 0),
		}
	})

	const outcome = computed(() => {
		if (!input.mode.value || input.amountMinor.value <= 0) {
			return t(`${TEXT}.outcome.empty`)
		}
		const sentence = t(
			`${TEXT}.outcome.${input.mode.value}`,
			outcomeParams.value,
		)
		return `${sentence} ${t(`${TEXT}.outcome.total`, outcomeParams.value)}`
	})

	const submitLabel = computed(() =>
		t(`${TEXT}.submit.${input.mode.value ?? 'credit_to_balance'}`, {
			amount: amount.value,
		}),
	)

	return {
		money,
		day,
		card,
		amount,
		subtitle,
		modeItems,
		outcome,
		outcomeParams,
		submitLabel,
	}
}
