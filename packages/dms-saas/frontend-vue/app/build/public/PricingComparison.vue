<script setup lang="ts">
import { computed, ref } from 'vue'
import {
	isPaidPlan,
	planReference,
	type PublicBillingRules,
	type PublicPlan,
	splitComparisonRows,
} from './pricing'
import { registerPathFor } from './routes'
import { usePublicPlanFormat } from './usePublicPlanFormat'

interface PricingComparisonProps {
	plans: PublicPlan[]
	features: TenantPlanFeature[]
	rules: PublicBillingRules
}

interface ComparisonCell {
	value: string
	note: string | null
}

interface ComparisonRow {
	id: string
	label: string
	tooltip: string | null
	cells: ComparisonCell[]
}

const props = defineProps<PricingComparisonProps>()

const UNLIMITED_MEMBERS = -1
const EMPTY_VALUE = '—'

const { t } = useI18n()
const { priceLabel } = usePublicPlanFormat()
const { formatFeatureValue } = usePlanFeatureFormat()
const { processI18n } = useTranslation()

const isDetailShown = ref(false)

function cell(value: string, note: string | null = null): ComparisonCell {
	return { value, note }
}

function membersCell(plan: PublicPlan): ComparisonCell {
	const value =
		plan.maxMembers === UNLIMITED_MEMBERS
			? t('saas.workspace.plan.unlimited')
			: String(plan.maxMembers)
	const note =
		plan.billingMode === 'seat'
			? t('saas.public.pricing.compare.billed_per_member')
			: null
	return cell(value, note)
}

function trialCell(plan: PublicPlan): ComparisonCell {
	if (!isPaidPlan(plan) || plan.trialDays <= 0) return cell(EMPTY_VALUE)
	return cell(
		t('saas.public.pricing.compare.days', { days: String(plan.trialDays) }),
	)
}

function guaranteeCell(plan: PublicPlan): ComparisonCell {
	const days = props.rules.moneyBackGuarantee?.windowDays
	if (!days || !isPaidPlan(plan)) return cell(EMPTY_VALUE)
	return cell(t('saas.public.pricing.compare.days', { days: String(days) }))
}

const billingRows = computed<ComparisonRow[]>(() => {
	const rows: ComparisonRow[] = [
		{
			id: 'members',
			label: t('saas.public.pricing.compare.members'),
			tooltip: null,
			cells: props.plans.map(membersCell),
		},
		{
			id: 'trial',
			label: t('saas.public.pricing.compare.trial'),
			tooltip: null,
			cells: props.plans.map(trialCell),
		},
	]
	if (!props.rules.moneyBackGuarantee) return rows
	return [
		...rows,
		{
			id: 'money-back',
			label: t('saas.public.pricing.compare.money_back'),
			tooltip: t('saas.public.pricing.compare.money_back_tooltip', {
				days: String(props.rules.moneyBackGuarantee.windowDays),
			}),
			cells: props.plans.map(guaranteeCell),
		},
	]
})

function featureRow(feature: TenantPlanFeature): ComparisonRow {
	return {
		id: feature.featureId,
		label: processI18n(feature.displayName),
		tooltip: feature.tooltip ? processI18n(feature.tooltip) : null,
		cells: props.plans.map((plan) =>
			cell(
				formatFeatureValue(
					feature,
					plan.featureValues[feature.featureId],
					plan.currency,
				),
			),
		),
	}
}

const rows = computed(() => splitComparisonRows(props.features))
const mainRows = computed(() => [
	...billingRows.value,
	...rows.value.main.map(featureRow),
])
const detailRows = computed(() => rows.value.detail.map(featureRow))
const visibleRows = computed(() =>
	isDetailShown.value
		? [...mainRows.value, ...detailRows.value]
		: mainRows.value,
)
</script>

<template>
	<section aria-labelledby="pricing-compare-title" class="flex flex-col gap-4">
		<header>
			<h2
				id="pricing-compare-title"
				class="text-highlighted text-lg font-semibold"
			>
				{{ $t('saas.public.pricing.compare.title') }}
			</h2>
			<p class="text-muted mt-1 text-[13px]">
				{{ $t('saas.public.pricing.compare.description') }}
			</p>
		</header>

		<DmsCard :padded="false" class="overflow-x-auto">
			<table class="w-full min-w-[640px] text-left text-[13px]">
				<thead>
					<tr class="border-default border-b">
						<th scope="col" class="text-muted w-1/4 px-4 py-3 font-medium">
							{{ $t('saas.public.pricing.compare.features') }}
						</th>
						<th
							v-for="plan in plans"
							:key="plan._id"
							scope="col"
							class="px-4 py-3 align-top"
						>
							<p class="text-highlighted font-semibold">{{ plan.name }}</p>
							<p class="text-muted text-xs font-normal">
								{{ priceLabel(plan) }}
							</p>
							<UButton
								:to="registerPathFor(planReference(plan))"
								:label="$t('saas.public.pricing.compare.choose')"
								size="xs"
								color="neutral"
								variant="outline"
								class="mt-2"
							/>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in visibleRows"
						:key="row.id"
						class="border-default border-b last:border-b-0"
					>
						<th scope="row" class="text-toned px-4 py-2.5 font-medium">
							<span class="inline-flex items-center gap-1.5">
								{{ row.label }}
								<UTooltip v-if="row.tooltip" :text="row.tooltip">
									<UIcon
										name="i-ph-info"
										class="text-dimmed size-3.5"
										:aria-label="row.tooltip"
									/>
								</UTooltip>
							</span>
						</th>
						<td
							v-for="(entry, index) in row.cells"
							:key="plans[index]?._id"
							class="text-highlighted px-4 py-2.5 tabular-nums"
						>
							{{ entry.value }}
							<span v-if="entry.note" class="text-muted block text-xs">
								{{ entry.note }}
							</span>
						</td>
					</tr>
				</tbody>
			</table>
		</DmsCard>

		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-muted text-xs">
				{{ $t('saas.public.pricing.compare.footnote') }}
			</p>
			<UButton
				v-if="detailRows.length"
				color="neutral"
				variant="ghost"
				size="sm"
				:icon="isDetailShown ? 'i-ph-caret-up' : 'i-ph-caret-down'"
				:label="
					isDetailShown
						? $t('saas.public.pricing.compare.show_less')
						: $t('saas.public.pricing.compare.show_detail', {
								count: detailRows.length,
							})
				"
				@click="isDetailShown = !isDetailShown"
			/>
		</div>
	</section>
</template>
