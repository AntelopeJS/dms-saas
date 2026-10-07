<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseSegmentGroup } from '../build/segments/tree'
import type {
	SegmentConditionGroup,
	SegmentLogical,
} from '../build/segments/types'
import { useSegmentCatalog } from '../build/segments/useSegmentCatalog'
import { useSegmentDraft } from '../build/segments/useSegmentDraft'
import { useSegmentSentence } from '../build/segments/useSegmentSentence'

const props = defineProps<{
	modelValue?: SegmentConditionGroup | string | null
	initialValue?: SegmentConditionGroup | string | null
	fieldsCatalogUrl?: string
	disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const catalog = useSegmentCatalog(props.fieldsCatalogUrl)
const { sentence } = useSegmentSentence(catalog)
const draft = useSegmentDraft()

const state = ref<SegmentConditionGroup>(
	parseSegmentGroup(props.modelValue ?? props.initialValue),
)
const counts = computed(() => draft.preview.value?.nodeCounts ?? {})
const summary = computed(() => sentence(state.value))

function publish(next: SegmentConditionGroup): void {
	state.value = next
	draft.conditions.value = next
}

function onUpdate(next: SegmentConditionGroup): void {
	publish(next)
	emit('update:modelValue', JSON.stringify(next))
}

function setLogical(logical: SegmentLogical): void {
	onUpdate({ ...state.value, logical })
}

watch(
	() => props.modelValue,
	(value) => {
		const parsed = parseSegmentGroup(value)
		if (JSON.stringify(parsed) !== JSON.stringify(state.value)) publish(parsed)
	},
)

onMounted(() => {
	draft.conditions.value = state.value
	void catalog.load()
})

onBeforeUnmount(() => {
	draft.conditions.value = null
	draft.preview.value = null
})
</script>

<template>
	<div class="flex flex-col gap-3">
		<div v-if="catalog.isLoading.value" class="flex flex-col gap-2">
			<USkeleton class="h-5 w-72" />
			<USkeleton v-for="row in 3" :key="row" class="h-8 w-full" />
		</div>
		<DmsSaasLoadFailure
			v-else-if="catalog.error.value"
			:title="$t('saas.segments.builder.load_failed')"
			@retry="catalog.refresh()"
		/>
		<template v-else>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span>{{ $t('saas.segments.builder.lead_before') }}</span>
				<DmsSaasSegmentLogicToggle
					:model-value="state.logical"
					:disabled="disabled"
					@update:model-value="setLogical"
				/>
				<span>{{ $t('saas.segments.builder.lead_after') }}</span>
			</div>
			<DmsSaasSegmentConditionsGroup
				:group="state"
				scope="user"
				:catalog="catalog"
				path=""
				:depth="0"
				:counts="counts"
				:disabled="disabled"
				@update="onUpdate"
			/>
			<p
				class="border-default bg-elevated/50 text-toned flex gap-2 rounded-lg border px-3 py-2 text-sm leading-6"
			>
				<UIcon name="i-ph-text-aa" class="text-dimmed mt-1 shrink-0" />
				<DmsSaasSegmentWords :tokens="summary" />
			</p>
		</template>
	</div>
</template>
