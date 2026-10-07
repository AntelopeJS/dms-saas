<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useWorkspaceName } from '../build/useWorkspaceName'

type ComplimentaryState = 'indefinite' | 'ending' | 'expired'

interface ComplimentaryView {
	tone: 'info' | 'warning' | 'error'
	icon: string
	title: string
	description: string
	canChoosePlan: boolean
}

const KEY_PREFIX = 'saas.tenant_billing.complimentary'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

// Bound to the shared state, not a snapshot: a plan change made from the
// sibling plan card must update the banner without a remount.
const { data, load } = useTenantPlan()
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus()
const { open: openPlanComparison } = usePlanComparison()
const { t, locale } = useI18n()
const workspaceName = useWorkspaceName()

const freeUntil = computed(() => data.value?.freeUntil ?? null)
const isTenantOwner = computed(() => !!billingStatus.value?.isTenantOwner)

const state = computed<ComplimentaryState | null>(() => {
	if (!data.value?.isComplimentary) return null
	if (isBlockingSubscriptionStatus(data.value.status)) return 'expired'
	return freeUntil.value ? 'ending' : 'indefinite'
})

const daysLeft = computed(() =>
	freeUntil.value ? countDaysUntil(freeUntil.value, new Date()) : 0,
)

function viewFor(current: ComplimentaryState): ComplimentaryView {
	const date = formatDate(freeUntil.value, locale.value, DAY_FORMAT) ?? ''
	const params = {
		workspace: workspaceName.value,
		plan: data.value?.current?.name ?? '',
		date,
		days: daysLeft.value,
	}
	const VIEWS: Record<ComplimentaryState, ComplimentaryView> = {
		indefinite: {
			tone: 'info',
			icon: 'i-ph-gift',
			title: t(`${KEY_PREFIX}.indefinite_title`),
			description: t(`${KEY_PREFIX}.indefinite_description`, params),
			canChoosePlan: false,
		},
		ending: {
			tone: 'warning',
			icon: 'i-ph-hourglass-medium',
			title: t(`${KEY_PREFIX}.ending_title`, params),
			description: t(
				`${KEY_PREFIX}.ending_description`,
				params,
				daysLeft.value,
			),
			canChoosePlan: true,
		},
		expired: {
			tone: 'error',
			icon: 'i-ph-warning-circle',
			title: date
				? t(`${KEY_PREFIX}.expired_title_on`, params)
				: t(`${KEY_PREFIX}.expired_title`),
			description: t(`${KEY_PREFIX}.expired_description`),
			canChoosePlan: true,
		},
	}
	return VIEWS[current]
}

const view = computed(() => (state.value ? viewFor(state.value) : null))

onMounted(() => {
	void load()
	void loadBillingStatus()
})
</script>

<template>
	<DmsBanner
		v-if="view"
		:tone="view.tone"
		:icon="view.icon"
		:title="view.title"
		:description="view.description"
	>
		<template v-if="view.canChoosePlan && isTenantOwner" #actions>
			<UButton
				size="sm"
				:color="view.tone === 'error' ? 'error' : 'primary'"
				icon="i-ph-stack"
				@click="openPlanComparison"
			>
				{{ $t(`${KEY_PREFIX}.choose_plan`) }}
			</UButton>
		</template>
	</DmsBanner>
</template>
