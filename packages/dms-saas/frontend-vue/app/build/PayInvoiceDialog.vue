<script setup lang="ts">
import { computed } from 'vue'
import PayInvoicePanel from './PayInvoicePanel.vue'

// Hosted by the past-due alert and the past-due strip; whichever opens it
// sets the shared target, so a single dialog shows at a time.
const { target, close } = usePayInvoice()
const { formatMinorUnits } = useMoneyFormat()

const open = computed({
	get: () => target.value !== null,
	set: (isOpen: boolean) => {
		if (!isOpen) close()
	},
})

const title = computed(() => {
	const invoice = target.value
	if (!invoice) return ''
	const amount = formatMinorUnits(invoice.amount, invoice.currency)
	return invoice.number ? `${invoice.number} · ${amount}` : amount
})
</script>

<template>
	<UModal
		v-model:open="open"
		:title="$t('saas.tenant_billing.pay.title', { invoice: title })"
		:ui="{ content: 'sm:max-w-md' }"
	>
		<template #body>
			<PayInvoicePanel
				v-if="target"
				:invoice="target"
				@paid="close"
				@cancel="close"
			/>
		</template>
	</UModal>
</template>
