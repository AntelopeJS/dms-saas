<script setup lang="ts">
import { computed } from 'vue'
import { adaptSegmentValue, newSegmentCondition } from '../build/segments/tree'
import type {
	SegmentCondition,
	SegmentFieldDefinition,
	SegmentOperator,
	SegmentPlanOption,
} from '../build/segments/types'
import { useSegmentWords } from '../build/segments/useSegmentWords'
import type { SegmentCatalog } from '../build/segments/useSegmentCatalog'

const props = defineProps<{
	condition: SegmentCondition
	fields: SegmentFieldDefinition[]
	plans: SegmentPlanOption[]
	catalog: SegmentCatalog
	/** WHERE, AND or OR, in front of the rule. */
	joinLabel: string
	/** Users the rule matches on its own, once the preview counted them. */
	count?: number
	/** Unit of `count`: users, or owners for a workspace rule. */
	countLabel: string
	disabled?: boolean
}>()

const emit = defineEmits<{
	update: [condition: SegmentCondition]
	remove: []
}>()

const { t } = useI18n()
const words = useSegmentWords(props.catalog)

interface FieldItem {
	label: string
	value?: string
	icon?: string
	description?: string
	type?: 'label'
	unit?: string
}

const field = computed(() =>
	props.fields.find((candidate) => candidate.id === props.condition.field),
)

const fieldItems = computed<FieldItem[][]>(() => {
	const groups = new Map<string, SegmentFieldDefinition[]>()
	for (const candidate of props.fields) {
		groups.set(candidate.group, [
			...(groups.get(candidate.group) ?? []),
			candidate,
		])
	}
	return [...groups].map(([group, fields]) => [
		{ type: 'label', label: t(`saas.segments.field_groups.${group}`) },
		...fields.map((candidate) => ({
			label: t(candidate.labelKey),
			value: candidate.id,
			icon: candidate.icon,
			description: t(candidate.descriptionKey),
			unit: candidate.unit
				? t(`saas.segments.units.kind.${candidate.unit}`)
				: t(`saas.segments.field_types.${candidate.type.replace(':', '_')}`),
		})),
	])
})

const operatorItems = computed(() =>
	(field.value?.operators ?? []).map((operator) => ({
		value: operator,
		label: words.operatorLabel(field.value, operator),
	})),
)

function changeField(fieldId: string): void {
	const next = props.fields.find((candidate) => candidate.id === fieldId)
	emit('update', newSegmentCondition(next))
}

function changeOperator(operator: SegmentOperator): void {
	emit('update', {
		...props.condition,
		operator,
		value: adaptSegmentValue(props.condition.value, operator),
	})
}

function changeValue(value: unknown): void {
	emit('update', { ...props.condition, value })
}

const formattedCount = computed(() =>
	props.count === undefined
		? null
		: t(props.countLabel, { count: props.count }, props.count),
)
</script>

<template>
	<div class="flex flex-wrap items-center gap-2 py-1">
		<span
			class="text-dimmed w-12 shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-wider"
		>
			{{ joinLabel }}
		</span>
		<USelectMenu
			:model-value="condition.field"
			:items="fieldItems"
			value-key="value"
			:icon="field?.icon"
			:disabled="disabled"
			:search-input="{ placeholder: $t('saas.segments.builder.search_fields') }"
			:aria-label="$t('saas.segments.builder.field')"
			size="sm"
			class="min-w-48"
			@update:model-value="changeField($event as string)"
		>
			<template #item-trailing="{ item }">
				<span class="text-dimmed font-mono text-[10px]">
					{{ (item as FieldItem).unit }}
				</span>
			</template>
			<template #empty>
				{{ $t('saas.segments.builder.no_field') }}
			</template>
		</USelectMenu>
		<USelect
			v-if="field"
			:model-value="condition.operator"
			:items="operatorItems"
			:disabled="disabled"
			:aria-label="$t('saas.segments.builder.operator')"
			size="sm"
			class="min-w-32"
			@update:model-value="changeOperator($event as SegmentOperator)"
		/>
		<DmsSaasSegmentValueInput
			v-if="field"
			:field="field"
			:operator="condition.operator"
			:model-value="condition.value"
			:plans="plans"
			:disabled="disabled"
			@update:model-value="changeValue"
		/>
		<span v-else class="text-error text-xs">
			{{ $t('saas.segments.unknown_field') }}
		</span>
		<span
			v-if="formattedCount"
			class="text-muted ms-auto font-mono text-[11px] tabular-nums"
		>
			{{ formattedCount }}
		</span>
		<UButton
			v-if="!disabled"
			:class="formattedCount ? '' : 'ms-auto'"
			color="neutral"
			variant="ghost"
			icon="i-ph-x"
			size="xs"
			:aria-label="$t('saas.segments.builder.remove_condition')"
			@click="emit('remove')"
		/>
	</div>
</template>
