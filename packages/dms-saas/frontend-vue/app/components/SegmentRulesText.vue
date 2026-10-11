<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { hasSegmentConditions, parseSegmentGroup } from '../build/segments/tree'
import { useSegmentCatalog } from '../build/segments/useSegmentCatalog'
import {
	type SegmentRulesMode,
	useSegmentWords,
} from '../build/segments/useSegmentWords'

const props = withDefaults(
	defineProps<{
		/** The rules, as the JSON string or the object a row holds. */
		conditions: unknown
		mode?: SegmentRulesMode
		fieldsCatalogUrl?: string
	}>(),
	{ mode: 'compact', fieldsCatalogUrl: undefined },
)

const catalog = useSegmentCatalog(props.fieldsCatalogUrl)
const words = useSegmentWords(catalog)

const group = computed(() => parseSegmentGroup(props.conditions))
const parts = computed(() => words.groupParts(group.value, 'user', props.mode))

onMounted(() => void catalog.load())
</script>

<template>
	<USkeleton v-if="catalog.isLoading.value" class="h-4 w-48" />
	<button
		v-else-if="catalog.error.value"
		type="button"
		class="text-error inline-flex items-center gap-1 text-xs"
		@click="catalog.refresh()"
	>
		<UIcon name="i-ph-arrow-clockwise" />
		{{ $t('saas.segments.rules.load_failed') }}
	</button>
	<span v-else-if="!hasSegmentConditions(group)" class="text-dimmed text-xs">
		{{ $t('saas.segments.rules.none') }}
	</span>
	<span v-else class="text-toned text-[12.5px] leading-6">
		<template v-for="(part, index) in parts" :key="index">
			<template v-if="index > 0">{{ ' ' }}</template>
			<UBadge
				v-if="part.kind === 'join'"
				:label="part.text"
				color="neutral"
				variant="outline"
				size="sm"
				class="font-mono text-[10px]"
			/>
			<DmsSaasSegmentWords v-else :tokens="part.tokens" />
		</template>
	</span>
</template>
