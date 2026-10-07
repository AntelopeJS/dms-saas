<script setup lang="ts">
import { computed } from 'vue'
import PayInvoicePanel from '../build/PayInvoicePanel.vue'

/** The invoices table row, as the list returned it. */
interface InvoiceRow {
	_id: string
	number?: string | null
	total?: number | null
	amount?: number | null
	currency?: string | null
	hostedInvoiceUrl?: string | null
}

// Opened by the "Pay invoice" row action of the billing page's table, which
// hands the row and closes the modal through `onSuccessCallback`.
const props = defineProps<{
	rowData?: InvoiceRow
	onSuccessCallback?: () => void
}>()

const emit = defineEmits<{ close: [] }>()

const invoice = computed<PayableInvoice | null>(() => {
	const row = props.rowData
	if (!row?._id) return null
	return {
		invoiceId: row._id,
		number: row.number ?? null,
		amount: row.total || row.amount || 0,
		currency: row.currency ?? 'EUR',
		hostedInvoiceUrl: row.hostedInvoiceUrl ?? null,
	}
})

function finish(): void {
	if (props.onSuccessCallback) {
		props.onSuccessCallback()
		return
	}
	emit('close')
}
</script>

<template>
	<PayInvoicePanel
		v-if="invoice"
		:invoice="invoice"
		@paid="finish"
		@cancel="finish"
	/>
	<DmsEmptyState
		v-else
		variant="error"
		size="sm"
		:title="$t('saas.tenant_billing.pay.missing')"
	/>
</template>
