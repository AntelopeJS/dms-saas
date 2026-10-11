<script setup lang="ts">
import { computed } from 'vue'
import {
	liveValue,
	useLiveFormValues,
} from '../build/composables/useLiveFormValues'

/** The settings the timeline is computed from, as the page loaded them. */
interface CustomerTimelineInput {
	autoSuspendEnabled: boolean
	autoSuspendDelayDays: number
	dataRetentionDaysAfterCancellation: number
}

interface TimelineStep {
	id: string
	icon: string
	tone: 'neutral' | 'warning' | 'error'
	title: string
	when: string
	effect: string
}

const props = defineProps<{
	modelValue?: CustomerTimelineInput | null
	componentId?: string
}>()

const TEXT = 'saas.operator_billing.billing_rules.unpaid.steps'
const DEFAULT_DELAY_DAYS = 14
const DEFAULT_RETENTION_DAYS = 30

const { t } = useI18n()
const live = useLiveFormValues(() => props.componentId)

const settings = computed<CustomerTimelineInput>(() => {
	const loaded = props.modelValue
	return {
		autoSuspendEnabled: liveValue(
			live.value,
			'autoSuspendEnabled',
			loaded?.autoSuspendEnabled ?? true,
		),
		autoSuspendDelayDays: liveValue(
			live.value,
			'autoSuspendDelayDays',
			loaded?.autoSuspendDelayDays ?? DEFAULT_DELAY_DAYS,
		),
		dataRetentionDaysAfterCancellation: liveValue(
			live.value,
			'dataRetentionDaysAfterCancellation',
			loaded?.dataRetentionDaysAfterCancellation ?? DEFAULT_RETENTION_DAYS,
		),
	}
})

function suspensionStep(): TimelineStep {
	const isEnabled = settings.value.autoSuspendEnabled
	const key = isEnabled ? 'suspended' : 'not_suspended'
	return {
		id: 'suspended',
		icon: isEnabled ? 'i-ph-prohibit' : 'i-ph-pause-circle',
		tone: isEnabled ? 'error' : 'neutral',
		title: t(`${TEXT}.${key}`),
		when: t(`${TEXT}.${key}_when`, {
			days: settings.value.autoSuspendDelayDays,
		}),
		effect: t(`${TEXT}.${key}_effect`),
	}
}

const steps = computed<TimelineStep[]>(() => [
	{
		id: 'failed',
		icon: 'i-ph-credit-card',
		tone: 'warning',
		title: t(`${TEXT}.failed`),
		when: t(`${TEXT}.failed_when`),
		effect: t(`${TEXT}.failed_effect`),
	},
	{
		id: 'retries',
		icon: 'i-ph-arrow-clockwise',
		tone: 'neutral',
		title: t(`${TEXT}.retries`),
		when: t(`${TEXT}.retries_when`),
		effect: t(`${TEXT}.retries_effect`),
	},
	suspensionStep(),
	{
		id: 'deleted',
		icon: 'i-ph-trash',
		tone: 'neutral',
		title: t(`${TEXT}.deleted`),
		when: t(`${TEXT}.deleted_when`, {
			days: settings.value.dataRetentionDaysAfterCancellation,
		}),
		effect: t(`${TEXT}.deleted_effect`),
	},
])
</script>

<template>
	<ol class="border-default divide-default divide-y rounded-lg border">
		<li
			v-for="step in steps"
			:key="step.id"
			class="flex items-start gap-3 px-3 py-2.5"
		>
			<DmsIconWell :icon="step.icon" :tone="step.tone" size="sm" />
			<div class="min-w-0 grow">
				<p class="text-highlighted text-sm font-medium">{{ step.title }}</p>
				<p class="text-muted text-xs">{{ step.effect }}</p>
			</div>
			<span class="text-toned shrink-0 font-mono text-xs">
				{{ step.when }}
			</span>
		</li>
	</ol>
</template>
