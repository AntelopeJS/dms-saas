<script setup lang="ts">
import { computed } from 'vue'

/** Where the cell reads the memo shown under the reason. */
interface CreditReasonOptions {
	memoField?: string
}

const props = defineProps<{
	value: unknown
	row?: Record<string, unknown>
	options?: CreditReasonOptions
}>()

const REASONS = 'saas.operator_billing.credit_reasons'

const { t, te } = useI18n()

const reason = computed(() => {
	const code = typeof props.value === 'string' ? props.value : ''
	if (!code) return '—'
	return te(`${REASONS}.${code}`) ? t(`${REASONS}.${code}`) : code
})

const memo = computed(() => {
	const field = props.options?.memoField
	const text = field ? props.row?.[field] : null
	return typeof text === 'string' ? text : ''
})
</script>

<template>
	<div class="flex min-w-0 flex-col">
		<span class="truncate text-sm">{{ reason }}</span>
		<span v-if="memo" class="text-muted truncate text-xs" :title="memo">
			{{ memo }}
		</span>
	</div>
</template>
