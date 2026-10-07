<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/** The figures of the next invoice the strip quotes. */
interface NextInvoiceSummary {
	totalMinorUnits: number | null
	currency: string | null
}

// Content of the trial-ending layout strip (see registerTrialEndingBanners),
// shown to the workspace owner 7, 3 and 1 day before the trial ends.
const KEY_PREFIX = 'saas.tenant_billing.trial'
const BILLING_PATH = '/settings/workspace/billing'
const NEXT_INVOICE_ENDPOINT = '/api/saas/tenant/upcoming-invoice'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { $authFetch } = useAuthFetch()
const { data: plan, load: loadPlan } = useTenantPlan()
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus()
const { formatMinorUnits } = useMoneyFormat()
const { t, locale } = useI18n()
const planIntervalLabel = usePlanIntervalLabel('saas.workspace.plan.interval')
const nextInvoice = ref<NextInvoiceSummary | null>(null)

const trialEndsAt = computed(() => plan.value?.currentPeriodEnd ?? null)
const daysLeft = computed(() =>
	trialEndsAt.value ? countDaysUntil(trialEndsAt.value, new Date()) : 0,
)
const card = computed(() => billingStatus.value?.paymentMethod ?? null)

const headline = computed(() =>
	t(
		`${KEY_PREFIX}.ends`,
		{
			plan: plan.value?.current?.name ?? '',
			date: formatDate(trialEndsAt.value, locale.value, DAY_FORMAT) ?? '',
			days: daysLeft.value,
		},
		daysLeft.value,
	),
)

const charge = computed(() => {
	const total = nextInvoice.value?.totalMinorUnits
	const interval = plan.value?.current?.interval
	if (typeof total !== 'number' || !interval) return null
	const params = {
		amount: formatMinorUnits(total, nextInvoice.value?.currency),
		interval: planIntervalLabel(interval),
	}
	return card.value
		? t(`${KEY_PREFIX}.charge_card`, {
				...params,
				card: formatCardLabel(card.value),
			})
		: t(`${KEY_PREFIX}.charge`, params)
})

async function loadNextInvoice(): Promise<void> {
	nextInvoice.value = await $authFetch<NextInvoiceSummary>(
		NEXT_INVOICE_ENDPOINT,
	).catch(() => null)
}

onMounted(() => {
	void loadPlan()
	void loadBillingStatus()
	void loadNextInvoice()
})
</script>

<template>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
		<p class="min-w-0 grow">
			<span class="text-highlighted font-medium">{{ headline }}</span>
			<template v-if="charge">. {{ charge }}</template>
		</p>
		<UButton size="xs" color="neutral" variant="outline" :to="BILLING_PATH">
			{{ $t(`${KEY_PREFIX}.compare`) }}
		</UButton>
		<DmsSaasCustomerPortalButton
			label-key="saas.tenant_billing.past_due.update_card"
			icon="i-ph-credit-card"
			size="xs"
		/>
	</div>
</template>
