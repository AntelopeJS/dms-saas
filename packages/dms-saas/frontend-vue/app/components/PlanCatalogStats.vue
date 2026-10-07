<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { formatPlanAmount, PLANS_ENDPOINT } from '../build/plan-catalog'

interface CurrencyMrr {
	currency: string
	mrr: number
}

interface CatalogueSummary {
	onSale: number
	publicOnSale: number
	salesLed: number
	workspaces: number
	paying: number
	free: number
	trialing: number
	mrr: CurrencyMrr[]
	legacy: number
	legacyWorkspaces: number
	legacyNames: string[]
}

const STAT_COUNT = 4

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()

const summary = ref<CatalogueSummary | null>(null)
const isLoading = ref(true)
const hasError = ref(false)

async function load(): Promise<void> {
	isLoading.value = true
	hasError.value = false
	try {
		summary.value = await $authFetch<CatalogueSummary>(
			`${PLANS_ENDPOINT}/summary`,
		)
	} catch {
		hasError.value = true
	} finally {
		isLoading.value = false
	}
}

function mrrValue(data: CatalogueSummary): string {
	const main = data.mrr[0]
	return main ? formatPlanAmount(main.mrr, main.currency, locale.value) : '—'
}

function mrrDetail(data: CatalogueSummary): string {
	const others = data.mrr.slice(1).filter((entry) => entry.mrr > 0)
	if (others.length === 0) return t('saas.catalog.plans.stats.mrr_detail')
	const listed = others
		.map((entry) => formatPlanAmount(entry.mrr, entry.currency, locale.value))
		.join(' · ')
	return t('saas.catalog.plans.stats.mrr_detail_other', { other: listed })
}

function legacyDetail(data: CatalogueSummary): string {
	if (data.legacyNames.length === 0)
		return t('saas.catalog.plans.stats.legacy_none')
	return t('saas.catalog.plans.stats.legacy_detail', {
		names: data.legacyNames.join(', '),
		count: data.legacyWorkspaces,
	})
}

const items = computed(() => {
	const data = summary.value
	if (!data) return []
	return [
		{
			id: 'on-sale',
			icon: 'i-ph-storefront',
			eyebrow: t('saas.catalog.plans.stats.on_sale'),
			value: data.onSale,
			detail: t('saas.catalog.plans.stats.on_sale_detail', {
				public: data.publicOnSale,
				sales: data.salesLed,
			}),
		},
		{
			id: 'workspaces',
			icon: 'i-ph-buildings',
			eyebrow: t('saas.catalog.plans.stats.workspaces'),
			value: data.workspaces,
			detail: t('saas.catalog.plans.stats.workspaces_detail', {
				paying: data.paying,
				free: data.free,
				trialing: data.trialing,
			}),
		},
		{
			id: 'mrr',
			icon: 'i-ph-chart-line-up',
			eyebrow: t('saas.catalog.plans.stats.mrr'),
			value: mrrValue(data),
			detail: mrrDetail(data),
		},
		{
			id: 'legacy',
			icon: 'i-ph-clock-counter-clockwise',
			tone: data.legacyWorkspaces > 0 ? ('warning' as const) : undefined,
			eyebrow: t('saas.catalog.plans.stats.legacy'),
			value: data.legacy,
			detail: legacyDetail(data),
			detailTone: data.legacyWorkspaces > 0 ? ('warning' as const) : undefined,
		},
	]
})

onMounted(load)
defineExpose({ refresh: load })
</script>

<template>
	<DmsSaasLoadFailure
		v-if="hasError"
		:title="$t('saas.catalog.plans.stats.failed')"
		@retry="load"
	/>
	<DmsStatGroup
		v-else
		:items="items"
		:loading="isLoading"
		:skeleton-count="STAT_COUNT"
		:label="$t('saas.catalog.plans.stats.label')"
	/>
</template>
