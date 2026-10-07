<script setup lang="ts">
/**
 * A public plan as the pricing page sells it: price, trial, call to action
 * and what it includes. Usable on a consumer's own pricing page too.
 */
import { computed } from 'vue'
import {
	featureHighlights,
	isPaidPlan,
	type PublicPlan,
} from '../build/public/pricing'
import { usePublicPlanFormat } from '../build/public/usePublicPlanFormat'

interface PlanCardPublicProps {
	plan: PublicPlan
	features: TenantPlanFeature[]
	/** The plan this one extends, when shown beside it. */
	parent?: PublicPlan | null
	/** Where the call to action leads. */
	to: string
}

const props = withDefaults(defineProps<PlanCardPublicProps>(), {
	parent: null,
})

const { t } = useI18n()
const { priceLabel, seatExampleLabel, termsLabel } = usePublicPlanFormat()
const planDescription = usePlanDescription()
const { formatFeatureValue } = usePlanFeatureFormat()
const { processI18n } = useTranslation()

const highlights = computed(() =>
	featureHighlights(props.plan, props.parent, props.features).map(
		({ feature, value }) => ({
			id: feature.featureId,
			name: processI18n(feature.displayName),
			value:
				feature.valueType === 'boolean'
					? null
					: formatFeatureValue(feature, value, props.plan.currency),
		}),
	),
)

const includesLabel = computed(() =>
	props.parent
		? t('saas.public.pricing.card.includes_parent', {
				plan: props.parent.name,
			})
		: t('saas.public.pricing.card.includes'),
)

const ctaLabel = computed(() => {
	if (!isPaidPlan(props.plan)) return t('saas.public.pricing.card.cta_free')
	if (props.plan.trialDays > 0) {
		return t('saas.public.pricing.card.cta_trial', {
			days: String(props.plan.trialDays),
		})
	}
	return t('saas.public.pricing.card.cta_paid', { plan: props.plan.name })
})

const accentStyle = computed(() =>
	props.plan.borderColor ? { borderColor: props.plan.borderColor } : undefined,
)
</script>

<template>
	<DmsCard
		as="article"
		:selected="!!plan.borderLabel"
		:padded="false"
		class="relative flex h-full flex-col gap-4 p-5"
		:style="accentStyle"
	>
		<DmsStatusPill
			v-if="plan.borderLabel"
			:label="plan.borderLabel"
			tone="primary"
			size="sm"
			dot="none"
			class="absolute right-4 top-4"
		/>

		<header class="pr-16">
			<h2 class="text-highlighted text-base font-semibold">{{ plan.name }}</h2>
			<p v-if="plan.description" class="text-muted mt-1 text-[13px]">
				{{ planDescription(plan.description) }}
			</p>
		</header>

		<div>
			<p class="text-highlighted text-2xl font-[650] tabular-nums">
				{{ priceLabel(plan) }}
			</p>
			<p v-if="seatExampleLabel(plan)" class="text-muted mt-1 text-xs">
				{{ seatExampleLabel(plan) }}
			</p>
			<p v-if="termsLabel(plan)" class="text-success mt-1 text-xs font-medium">
				{{ termsLabel(plan) }}
			</p>
		</div>

		<UButton
			:to="to"
			:label="ctaLabel"
			:color="plan.borderLabel ? 'primary' : 'neutral'"
			:variant="plan.borderLabel ? 'solid' : 'outline'"
			class="justify-center"
			block
		/>

		<div v-if="highlights.length" class="border-default border-t pt-4">
			<DmsEyebrow as="h3" :label="includesLabel" class="mb-2.5" />
			<ul class="flex flex-col gap-1.5 text-[13px]">
				<li v-for="item in highlights" :key="item.id" class="flex gap-2">
					<UIcon
						name="i-ph-check"
						class="text-success mt-0.5 size-4 shrink-0"
					/>
					<span>
						<span v-if="item.value" class="text-highlighted font-medium">
							{{ item.value }}
						</span>
						{{ item.name }}
					</span>
				</li>
			</ul>
		</div>
	</DmsCard>
</template>
