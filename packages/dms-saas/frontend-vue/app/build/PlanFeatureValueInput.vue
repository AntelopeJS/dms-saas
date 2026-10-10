<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type ValueType = 'boolean' | 'number' | 'string'
type NumberMode = 'off' | 'limit' | 'unlimited'

const OFF = 0
const UNLIMITED = -1
const MIN_LIMIT = 1

const props = defineProps<{
	valueType: ValueType
	modelValue: unknown
	unit?: string | null
	disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const { t } = useI18n()

function modeOf(value: unknown): NumberMode {
	if (value === UNLIMITED) return 'unlimited'
	return typeof value === 'number' && value !== OFF ? 'limit' : 'off'
}

const mode = computed(() => modeOf(props.modelValue))
// The last limit typed, kept while Off or Unlimited is picked, so switching
// back to Limit restores it.
const limit = ref<number | null>(
	typeof props.modelValue === 'number' && props.modelValue > OFF
		? props.modelValue
		: null,
)

watch(
	() => props.modelValue,
	(value) => {
		if (typeof value === 'number' && value !== OFF && value !== UNLIMITED) {
			limit.value = value
		}
	},
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

const NUMBER_MODE_VALUES: Record<NumberMode, () => unknown> = {
	off: () => OFF,
	limit: () => limit.value ?? MIN_LIMIT,
	unlimited: () => UNLIMITED,
}

function setNumberMode(next: string | number | undefined): void {
	const picked = (next ?? 'off') as NumberMode
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
			<DmsSegmented
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
				<span v-if="unit" class="text-muted text-xs">{{ unit }}</span>
			</div>
		</div>
		<DmsSegmented
			v-else-if="valueType === 'boolean'"
			:model-value="modelValue === true ? 'on' : 'off'"
			:items="booleanModes"
			:disabled="disabled"
			size="xs"
			:aria-label="$t('saas.catalog.editor.feature.mode')"
			@update:model-value="setBoolean"
		/>
		<UInput
			v-else
			:model-value="typeof modelValue === 'string' ? modelValue : ''"
			size="xs"
			class="w-full max-w-xs"
			:disabled="disabled"
			:placeholder="$t('saas.catalog.editor.feature.text_placeholder')"
			@update:model-value="(value: string) => emit('update:modelValue', value)"
		/>
		<p v-if="limitError" class="text-error text-xs">{{ limitError }}</p>
	</div>
</template>
