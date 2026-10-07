<script setup lang="ts">
import { computed } from 'vue'
import { isListOperator } from '../build/segments/tree'
import type {
	SegmentFieldDefinition,
	SegmentOperator,
	SegmentPlanOption,
} from '../build/segments/types'
import { fromMinorUnits, toMinorUnits } from '../composables/useMoneyFormat'

const props = defineProps<{
	field: SegmentFieldDefinition
	operator: SegmentOperator
	modelValue: unknown
	plans: SegmentPlanOption[]
	disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const { t } = useI18n()

const DEFAULT_CURRENCY = 'EUR'
const UNIT_LABELS: Record<string, () => string> = {
	days: () => t('saas.segments.units.days_unit'),
	count: () => '',
	currency: () => DEFAULT_CURRENCY,
}

interface ValueOption {
	value: string
	label: string
	tone: string
}

const NEUTRAL_TONE = 'neutral'

const isEnum = computed(
	() => props.field.type === 'enum' || props.field.type === 'enum:plan',
)
const isList = computed(() => isListOperator(props.operator))
const isCurrency = computed(() => props.field.unit === 'currency')
const unitLabel = computed(() =>
	props.field.unit ? UNIT_LABELS[props.field.unit]?.() : '',
)

const options = computed<ValueOption[]>(() => {
	if (props.field.type === 'enum:plan') {
		return props.plans.map((plan) => ({
			value: plan._id,
			label: plan.name,
			tone: NEUTRAL_TONE,
		}))
	}
	return (props.field.enumOptions ?? []).map((option) => ({
		value: option.value,
		label: t(option.labelKey),
		tone: option.tone ?? NEUTRAL_TONE,
	}))
})

const selectedOptions = computed(() => {
	const picked = new Set(
		isList.value ? listValue.value : [String(props.modelValue ?? '')],
	)
	return options.value.filter((option) => picked.has(option.value))
})

const listValue = computed(() =>
	Array.isArray(props.modelValue) ? props.modelValue.map(String) : [],
)

const numberValue = computed(() => {
	const value = Number(props.modelValue)
	if (!Number.isFinite(value)) return 0
	return isCurrency.value ? fromMinorUnits(value, DEFAULT_CURRENCY) : value
})

function updateNumber(value: number | null | undefined): void {
	const number = Number(value ?? 0)
	emit(
		'update:modelValue',
		isCurrency.value ? toMinorUnits(number, DEFAULT_CURRENCY) : number,
	)
}

const booleanValue = computed(
	() => props.modelValue === true || props.modelValue === 'true',
)
</script>

<template>
	<USelectMenu
		v-if="isEnum || isList"
		:model-value="isList ? listValue : String(modelValue ?? '')"
		:items="options"
		value-key="value"
		:multiple="isList"
		:disabled="disabled"
		:placeholder="$t('saas.segments.builder.pick_values')"
		:search-input="{ placeholder: $t('saas.segments.builder.search') }"
		size="sm"
		class="min-w-44"
		@update:model-value="emit('update:modelValue', $event)"
	>
		<span v-if="selectedOptions.length" class="flex flex-wrap gap-1">
			<DmsStatusPill
				v-for="option in selectedOptions"
				:key="option.value"
				:tone="option.tone"
				:label="option.label"
				dot="none"
				size="sm"
				:mono="false"
			/>
		</span>
		<span v-else class="text-dimmed">
			{{ $t('saas.segments.builder.pick_values') }}
		</span>
	</USelectMenu>
	<UFieldGroup v-else-if="field.valueKind === 'boolean'" size="sm">
		<UButton
			v-for="choice in [true, false]"
			:key="String(choice)"
			:label="$t(`saas.segments.boolean.${choice}`)"
			:color="booleanValue === choice ? 'primary' : 'neutral'"
			:variant="booleanValue === choice ? 'soft' : 'outline'"
			:disabled="disabled"
			:aria-pressed="booleanValue === choice"
			@click="emit('update:modelValue', choice)"
		/>
	</UFieldGroup>
	<UInputNumber
		v-else-if="field.valueKind === 'number'"
		:model-value="numberValue"
		:min="isCurrency ? 0 : undefined"
		:step="isCurrency ? 0.01 : 1"
		:disabled="disabled"
		size="sm"
		class="w-36"
		@update:model-value="updateNumber"
	>
		<template v-if="unitLabel" #trailing>
			<span class="text-muted pe-6 text-xs">{{ unitLabel }}</span>
		</template>
	</UInputNumber>
	<UInput
		v-else-if="field.valueKind === 'date'"
		:model-value="String(modelValue ?? '')"
		type="date"
		:disabled="disabled"
		size="sm"
		class="w-40"
		@update:model-value="emit('update:modelValue', $event)"
	/>
	<UInput
		v-else
		:model-value="String(modelValue ?? '')"
		:disabled="disabled"
		:placeholder="$t('saas.segments.builder.type_value')"
		size="sm"
		class="w-48"
		@update:model-value="emit('update:modelValue', $event)"
	/>
</template>
