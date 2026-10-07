<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const UNLIMITED = -1
const MIN_LIMIT = 1

const props = defineProps<{
	modelValue?: number | null
	disabled?: boolean
	unit?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const { processI18n } = useTranslation()
const { t } = useI18n()

const isUnlimited = computed(
	() => props.modelValue === UNLIMITED || props.modelValue == null,
)
// The last cap typed, so ticking Unlimited off restores it.
const lastLimit = ref<number>(
	typeof props.modelValue === 'number' && props.modelValue >= MIN_LIMIT
		? props.modelValue
		: MIN_LIMIT,
)

watch(
	() => props.modelValue,
	(value) => {
		if (typeof value === 'number' && value >= MIN_LIMIT) lastLimit.value = value
	},
)

const limitError = computed(() =>
	!isUnlimited.value &&
	(typeof props.modelValue !== 'number' || props.modelValue < MIN_LIMIT)
		? t('saas.catalog.editor.limit_error')
		: null,
)

function setUnlimited(value: boolean | 'indeterminate'): void {
	emit('update:modelValue', value === true ? UNLIMITED : lastLimit.value)
}

function setLimit(value: number | null | undefined): void {
	emit('update:modelValue', value ?? 0)
}
</script>

<template>
	<div class="flex flex-col gap-1">
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				<UInputNumber
					:model-value="isUnlimited ? undefined : (modelValue ?? undefined)"
					:min="MIN_LIMIT"
					:step="1"
					class="w-32"
					:disabled="disabled || isUnlimited"
					:placeholder="
						isUnlimited ? $t('saas.catalog.plans.unlimited') : undefined
					"
					:color="limitError ? 'error' : undefined"
					:highlight="!!limitError"
					@update:model-value="setLimit"
				/>
				<span v-if="unit" class="text-muted text-sm">
					{{ processI18n(unit) }}
				</span>
			</div>
			<UCheckbox
				:model-value="isUnlimited"
				:disabled="disabled"
				:label="$t('saas.catalog.plans.unlimited')"
				@update:model-value="setUnlimited"
			/>
		</div>
		<p v-if="limitError" class="text-error text-xs">{{ limitError }}</p>
	</div>
</template>
