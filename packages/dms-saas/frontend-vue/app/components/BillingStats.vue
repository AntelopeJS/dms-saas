<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/** An amount in one currency, in minor units. */
interface MoneyFigure {
	amount: number
	currency: string
}

type StatParam = number | MoneyFigure[]

interface StatText {
	key: string
	params?: Record<string, StatParam>
}

interface BillingStat {
	id: string
	icon: string
	tone: 'neutral' | 'primary' | 'success' | 'warning' | 'error'
	eyebrow: string
	value: StatParam
	detail: StatText
}

interface BillingStatsResponse {
	items?: BillingStat[]
}

interface BillingStatsProps {
	/** Route answering `{ items }`, the figures in their raw form. */
	fetchUrl: string
	/** Placeholder cells drawn while the figures load. */
	skeletonCount?: number
}

const props = withDefaults(defineProps<BillingStatsProps>(), {
	skeletonCount: 4,
})

const { t, locale } = useI18n()
const { formatMinorUnits } = useMoneyFormat()
const { $authFetch } = useAuthFetch()

const items = ref<BillingStat[]>([])
const isLoading = ref(true)
const hasFailed = ref(false)

async function load(): Promise<void> {
	isLoading.value = true
	hasFailed.value = false
	try {
		const response = await $authFetch<BillingStatsResponse>(props.fetchUrl)
		items.value = response.items ?? []
	} catch {
		hasFailed.value = true
	} finally {
		isLoading.value = false
	}
}

onMounted(load)

const isMoney = (value: StatParam): value is MoneyFigure[] =>
	Array.isArray(value)

const formatMoney = (figures: MoneyFigure[]): string =>
	figures
		.map((figure) => formatMinorUnits(figure.amount, figure.currency))
		.join(' + ')

function formatParam(value: StatParam): string {
	if (isMoney(value)) return formatMoney(value)
	return new Intl.NumberFormat(locale.value).format(value)
}

function formatParams(params: Record<string, StatParam> = {}) {
	return Object.fromEntries(
		Object.entries(params).map(([name, value]) => [
			name,
			isMoney(value) ? formatParam(value) : value,
		]),
	)
}

// The first currency is the figure; the others are noted before the detail.
function detailOf(stat: BillingStat): string {
	const count = stat.detail.params?.count
	const detail = t(
		stat.detail.key,
		formatParams(stat.detail.params),
		typeof count === 'number' ? count : 1,
	)
	if (!isMoney(stat.value) || stat.value.length < 2) return detail
	const others = formatMoney(stat.value.slice(1))
	return t('saas.operator_billing.stats.other_currencies', {
		amounts: others,
		detail,
	})
}

const resolvedItems = computed(() =>
	items.value.map((stat) => ({
		id: stat.id,
		icon: stat.icon,
		tone: stat.tone,
		eyebrow: t(stat.eyebrow),
		value: isMoney(stat.value)
			? formatMoney(stat.value.slice(0, 1))
			: formatParam(stat.value),
		detail: detailOf(stat),
	})),
)
</script>

<template>
	<DmsSaasLoadFailure
		v-if="hasFailed"
		:title="$t('saas.operator_billing.stats.load_failed')"
		@retry="load"
	/>
	<DmsStatGroup
		v-else
		layout="joined"
		:items="resolvedItems"
		:loading="isLoading"
		:skeleton-count="skeletonCount"
		:label="$t('saas.operator_billing.stats.label')"
	/>
</template>
