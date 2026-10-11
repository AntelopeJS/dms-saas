<script setup lang="ts">
import { computed } from 'vue'
import type { CreditNotePreview } from '../composables/useCreditNoteDraft'

const props = defineProps<{ preview: CreditNotePreview }>()

const TEXT = 'saas.operator_billing.credit_modal'
const LINE_PERIOD_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { t, locale } = useI18n()
const { formatMinorUnits } = useMoneyFormat()

const currency = computed(() => props.preview.invoice.currency)
const money = (amount: number) => formatMinorUnits(amount, currency.value)
const day = (value: string | null) =>
	formatDate(value, locale.value, LINE_PERIOD_FORMAT) ?? ''

function linePeriod(start: string | null, end: string | null): string {
	if (!start) return ''
	return end ? `${day(start)} – ${day(end)}` : day(start)
}

const lineItems = computed(() =>
	props.preview.invoice.lines.map((line, index) => ({
		id: `line-${index}`,
		label: line.description || '—',
		value: money(line.amount),
		type: 'mono' as const,
		detail: linePeriod(line.periodStart, line.periodEnd),
	})),
)

const settledItem = computed(() => {
	const isPaid = props.preview.invoice.status === 'paid'
	return {
		id: 'settled',
		label: t(`${TEXT}.${isPaid ? 'paid' : 'total'}`),
		value: money(
			isPaid ? props.preview.invoice.amountPaid : props.preview.invoice.total,
		),
		type: 'mono' as const,
	}
})

const creditItems = computed(() =>
	props.preview.priorCredits
		.filter((note) => note.status === 'issued')
		.map((note) => ({
			id: note.number,
			label: t(`${TEXT}.already_credited`),
			detail: `${note.number} · ${day(note.issuedAt)}`,
			value: money(-note.amount),
			type: 'mono' as const,
		})),
)

const items = computed(() => [
	...lineItems.value,
	{
		id: 'tax',
		label: t(`${TEXT}.tax`),
		value: money(props.preview.invoice.tax),
		type: 'mono' as const,
	},
	settledItem.value,
	...creditItems.value,
	{
		id: 'creditable',
		label: t(`${TEXT}.still_creditable`),
		value: money(props.preview.creditable),
		type: 'mono' as const,
		tone: 'success' as const,
	},
])
</script>

<template>
	<DmsKeyValueList :items="items" dense />
</template>
