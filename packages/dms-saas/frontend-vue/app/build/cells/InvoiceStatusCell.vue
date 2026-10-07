<script setup lang="ts">
import { computed } from 'vue'
import { saasStatusTone } from '../../composables/useSaasStatus'

const props = defineProps<{
	value: unknown
	row?: Record<string, unknown>
}>()

const TEXT = 'saas.operator_billing.invoices.sub_state'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { t, locale } = useI18n()

const status = computed(() => String(props.value ?? ''))
const read = (field: string) => props.row?.[field]
const day = (field: string) =>
	formatDate(read(field), locale.value, DAY_FORMAT) ?? ''

const hasFailedPayment = computed(
	() => status.value === 'open' && Number(read('attemptCount') ?? 0) > 0,
)

function openSubState(): string | null {
	const hasFailed = hasFailedPayment.value
	if (hasFailed && read('nextPaymentAttemptAt')) {
		return t(`${TEXT}.retry`, { date: day('nextPaymentAttemptAt') })
	}
	if (hasFailed) return t(`${TEXT}.retries_over`)
	if (read('dueAt')) return t(`${TEXT}.due`, { date: day('dueAt') })
	return null
}

const SUB_STATES: Record<string, () => string | null> = {
	draft: () =>
		read('autoFinalizesAt')
			? t(`${TEXT}.finalises`, { date: day('autoFinalizesAt') })
			: null,
	open: openSubState,
	void: () =>
		read('replacedByNumber')
			? t(`${TEXT}.replaced_by`, { number: read('replacedByNumber') })
			: null,
	uncollectible: () => t(`${TEXT}.written_off`),
}

const subState = computed(() => SUB_STATES[status.value]?.() ?? null)
const tone = computed(() => saasStatusTone('invoice', status.value))
const isAlert = computed(
	() => hasFailedPayment.value || status.value === 'uncollectible',
)
</script>

<template>
	<div class="flex flex-col items-start gap-0.5">
		<DmsStatusPill :tone="tone" :label="$t(`saas.status.invoice.${status}`)" />
		<span
			v-if="subState"
			class="text-xs"
			:class="isAlert ? 'text-error' : 'text-muted'"
		>
			{{ subState }}
		</span>
	</div>
</template>
