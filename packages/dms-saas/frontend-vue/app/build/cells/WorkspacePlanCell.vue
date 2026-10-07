<script setup lang="ts">
import { computed } from 'vue'

/** Where the cell reads the plan and the seats on the row. */
interface WorkspacePlanOptions {
	planField?: string
	seatsField?: string
}

const props = defineProps<{
	value: unknown
	row?: Record<string, unknown>
	options?: WorkspacePlanOptions
}>()

const { t } = useI18n()

const subtitle = computed(() => {
	const plan = props.options?.planField
		? props.row?.[props.options.planField]
		: null
	const seats = props.options?.seatsField
		? Number(props.row?.[props.options.seatsField] ?? 0)
		: 0
	if (typeof plan !== 'string' || !plan) return ''
	if (seats < 2) return plan
	return t('saas.operator_billing.cells.plan_seats', { plan, seats })
})
</script>

<template>
	<div class="flex min-w-0 flex-col">
		<span class="text-highlighted truncate text-sm font-medium">
			{{ value ?? '—' }}
		</span>
		<span v-if="subtitle" class="text-muted truncate text-xs">
			{{ subtitle }}
		</span>
	</div>
</template>
