<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	isFeatureNumber,
	isFeatureText,
	isPlanFeatureValue,
	PLAN_UNLIMITED,
	type PlanFeatureValue,
} from './plan-catalog'

type ValueType = 'boolean' | 'number' | 'string'

const NUMBER_MODES = ['off', 'limit', 'unlimited'] as const
type NumberMode = (typeof NUMBER_MODES)[number]
const NUMBER_MODE_SET: ReadonlySet<string | number> = new Set(NUMBER_MODES)

const OFF = 0
const MIN_LIMIT = 1

const props = defineProps<{
	valueType: ValueType
	modelValue: unknown
	unit?: string | null
	disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const { t, locale } = useI18n()

const current = computed<PlanFeatureValue>(() =>
	isPlanFeatureValue(props.modelValue) ? props.modelValue : null,
)

function modeOf(value: PlanFeatureValue): NumberMode {
	if (value === PLAN_UNLIMITED) return 'unlimited'
	return isFeatureNumber(value) && value !== OFF ? 'limit' : 'off'
}

function isNumberMode(value: string | number): value is NumberMode {
	return NUMBER_MODE_SET.has(value)
}

const mode = computed(() => modeOf(current.value))
const text = computed(() => (isFeatureText(current.value) ? current.value : ''))

/**
 * The last limit typed, kept while Off or Unlimited is picked, so switching
 * back to Limit restores it.
 */
const limit = ref<number | null>(
	isFeatureNumber(current.value) && current.value > OFF ? current.value : null,
)

watch(current, (value) => {
	if (isFeatureNumber(value) && value !== OFF && value !== PLAN_UNLIMITED) {
		limit.value = value
	}
})

/** A unit stored `singular | plural` reads in the form the typed limit takes. */
const unitLabel = computed(() =>
	props.unit
		? agreeUnit(props.unit, limit.value ?? MIN_LIMIT, locale.value)
		: '',
)

const limitError = computed(() =>
	mode.value === 'limit' &&
	(limit.value === null ||
		!Number.isInteger(limit.value) ||
		limit.value < MIN_LIMIT)
		? t('saas.catalog.editor.feature.limit_error')
		: null,
)

const numberModes = computed(() => [
	{ value: 'off', label: t('saas.catalog.editor.feature.off') },
	{ value: 'limit', label: t('saas.catalog.editor.feature.limit') },
	{ value: 'unlimited', label: t('saas.catalog.editor.feature.unlimited') },
])

const booleanModes = computed(() => [
	{ value: 'off', label: t('saas.catalog.editor.feature.not_included') },
	{ value: 'on', label: t('saas.catalog.editor.feature.included') },
])

const NUMBER_MODE_VALUES: Record<NumberMode, () => number> = {
	off: () => OFF,
	limit: () => limit.value ?? MIN_LIMIT,
	unlimited: () => PLAN_UNLIMITED,
}

function setNumberMode(next: string | number | undefined): void {
	const picked = next ?? 'off'
	if (!isNumberMode(picked)) return
	if (picked === 'limit' && limit.value === null) limit.value = MIN_LIMIT
	emit('update:modelValue', NUMBER_MODE_VALUES[picked]())
}

function setLimit(value: number | null | undefined): void {
	limit.value = value ?? null
	emit('update:modelValue', value ?? OFF)
}

function setBoolean(next: string | number | undefined): void {
	emit('update:modelValue', next === 'on')
}
</script>

<template>
	<div class="flex flex-col gap-1">
		<div
			v-if="valueType === 'number'"
			class="flex flex-wrap items-center gap-2"
		>
			<DmsSegmentedControl
				:model-value="mode"
				:items="numberModes"
				:disabled="disabled"
				size="xs"
				:aria-label="$t('saas.catalog.editor.feature.mode')"
				@update:model-value="setNumberMode"
			/>
			<div v-if="mode === 'limit'" class="flex items-center gap-1.5">
				<UInputNumber
					:model-value="limit ?? undefined"
					:min="MIN_LIMIT"
					:step="1"
					size="xs"
					class="w-28"
					:disabled="disabled"
					:color="limitError ? 'error' : undefined"
					:highlight="!!limitError"
					@update:model-value="setLimit"
				/>
				<span v-if="unitLabel" class="text-muted text-xs">{{ unitLabel }}</span>
			</div>
		</div>
		<DmsSegmentedControl
			v-else-if="valueType === 'boolean'"
			:model-value="current === true ? 'on' : 'off'"
			:items="booleanModes"
			:disabled="disabled"
			size="xs"
			:aria-label="$t('saas.catalog.editor.feature.mode')"
			@update:model-value="setBoolean"
		/>
		<UInput
			v-else
			:model-value="text"
			size="xs"
			class="w-full max-w-xs"
			:disabled="disabled"
			:placeholder="$t('saas.catalog.editor.feature.text_placeholder')"
			@update:model-value="(value: string) => emit('update:modelValue', value)"
		/>
		<p v-if="limitError" class="text-error text-xs">{{ limitError }}</p>
	</div>
</template>
