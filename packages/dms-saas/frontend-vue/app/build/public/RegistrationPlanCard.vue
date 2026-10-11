<script setup lang="ts">
/**
 * The plan a sign-up opens the workspace on, with "Change" leading to
 * Pricing, and the paid plan chosen there when there is one.
 */
import { computed } from 'vue'
import { featureHighlights, type RegistrationPlanSummary } from './pricing'
import { usePublicPlanFormat } from './usePublicPlanFormat'

interface RegistrationPlanCardProps {
	summary: RegistrationPlanSummary | null
	isLoading: boolean
	loadError: string | null
	/** Link to Pricing, when the deployment serves it. */
	changeTo: string | null
	/** Defaults to "Change". */
	changeLabel?: string
	/** `_blank` keeps the current screen, e.g. one holding a sign-in token. */
	changeTarget?: string
	/** Lists the plan's main features under it. */
	isDetailed?: boolean
}

const props = withDefaults(defineProps<RegistrationPlanCardProps>(), {
	changeLabel: undefined,
	changeTarget: undefined,
	isDetailed: false,
})
const emit = defineEmits<{ retry: [] }>()

const MAX_HIGHLIGHTS = 4

const { priceLabel } = usePublicPlanFormat()
const { formatFeatureValue } = usePlanFeatureFormat()
const { processI18n } = useTranslation()
const planDescription = usePlanDescription()

const highlights = computed(() => {
	const summary = props.summary
	if (!summary || !props.isDetailed) return []
	return featureHighlights(summary.plan, null, summary.features)
		.slice(0, MAX_HIGHLIGHTS)
		.map(({ feature, value }) => ({
			id: feature.featureId,
			label:
				feature.valueType === 'boolean'
					? processI18n(feature.displayName)
					: `${formatFeatureValue(feature, value, summary.plan.currency)} ${processI18n(feature.displayName)}`,
		}))
})
</script>

<template>
	<USkeleton v-if="isLoading && !summary" class="h-14 w-full rounded-lg" />

	<DmsBanner
		v-else-if="loadError"
		tone="error"
		size="sm"
		icon="i-ph-warning-circle"
		:title="$t('saas.public.plan_card.load_error')"
		:description="loadError"
	>
		<template #actions>
			<UButton
				size="xs"
				color="neutral"
				variant="outline"
				:label="$t('saas.public.common.retry')"
				@click="emit('retry')"
			/>
		</template>
	</DmsBanner>

	<div v-else-if="summary" class="flex flex-col gap-2">
		<DmsCard
			:padded="false"
			class="flex items-start justify-between gap-3 px-4 py-3"
		>
			<div class="min-w-0">
				<DmsEyebrow as="span" :label="$t('saas.public.plan_card.eyebrow')" />
				<p class="text-highlighted text-sm font-semibold">
					{{ summary.plan.name }}
					<span class="text-muted font-normal">
						· {{ priceLabel(summary.plan) }}
					</span>
				</p>
				<p
					v-if="isDetailed && summary.plan.description"
					class="text-muted text-xs"
				>
					{{ planDescription(summary.plan.description) }}
				</p>
				<ul
					v-if="highlights.length"
					class="text-muted mt-1.5 flex flex-wrap gap-x-3 text-xs"
				>
					<li v-for="item in highlights" :key="item.id">{{ item.label }}</li>
				</ul>
			</div>
			<UButton
				v-if="changeTo"
				:to="changeTo"
				:target="changeTarget"
				:label="changeLabel ?? $t('saas.public.plan_card.change')"
				size="xs"
				color="neutral"
				variant="ghost"
			/>
		</DmsCard>

		<p v-if="summary.requestedPlan" class="text-muted flex gap-1.5 text-xs">
			<UIcon name="i-ph-info" class="mt-0.5 size-3.5 shrink-0" />
			{{
				$t('saas.public.plan_card.requested', {
					requested: summary.requestedPlan.name,
					plan: summary.plan.name,
				})
			}}
		</p>
	</div>
</template>
