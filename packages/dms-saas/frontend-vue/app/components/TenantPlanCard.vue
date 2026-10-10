<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useWorkspaceName } from '../build/useWorkspaceName'
import { UPGRADE_QUERY_PARAM } from '../composables/usePlanChangeReview'
import { BILLING_CHOOSE_PLAN_PARAM } from '../build/public/routes'

const KEY_PREFIX = 'saas.tenant_billing.plan'
const MEMBERS_PATH = '/settings/workspace/members'
const DATA_EXPORT_PATH = '/settings/workspace/data-export'
const CHOOSE_PLAN_LINK_SELECTOR = `a[href="#${BILLING_CHOOSE_PLAN_PARAM}"]`
const FREE_STATE = 'free'
const ACTIVE_STATUS = 'active'
const TRIALING_STATUS = 'trialing'
const PAST_DUE_STATUS = 'past_due'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

const toast = useToast()
const { t, locale } = useI18n()
const { confirm } = useConfirm()
const { resolveApiError } = useApiErrorMessage()
const tenantPlan = useTenantPlan()
const { data, error: loadError } = tenantPlan
const billingStatus = useBillingStatus()
const { formatMajorUnits } = useMoneyFormat()
const { statusView } = useSaasStatus()
const planDescription = usePlanDescription()
const { formatFeatureValue } = usePlanFeatureFormat()
const comparison = usePlanComparison()
const { consumeCancelledCheckout } = usePendingCheckout()
const { workspace, load: loadWorkspace } = useCurrentWorkspace()
const planIntervalLabel = usePlanIntervalLabel('saas.workspace.plan.interval')
const workspaceName = useWorkspaceName()
const route = useDmsRoute()
const router = useDmsRouter()

const isLoading = ref(true)
const isWorking = ref(false)
const isUpgradeOpen = ref(false)
const upgradeTarget = ref<OfferedPlanView | null>(null)

const current = computed(() => data.value?.current ?? null)
const seats = computed<SeatsInUse>(
	() => data.value?.seats ?? { members: 0, pendingInvites: 0, occupied: 0 },
)
const pendingPlan = computed(() => data.value?.pendingPlan ?? null)
const status = computed(() => billingStatus.data.value)
const isTenantOwner = computed(() => !!status.value?.isTenantOwner)
const isPaid = computed(() => (current.value?.price ?? 0) > 0)
const isSeatPlan = computed(() => current.value?.billingMode === 'seat')
const cancellationAt = computed(
	() => status.value?.scheduledCancellationAt ?? null,
)
const canResubscribe = computed(() => !!data.value?.canResubscribe)
const isStripeBilled = computed(
	() =>
		!!status.value?.hasStripeCustomer &&
		isPaid.value &&
		!data.value?.isComplimentary &&
		!canResubscribe.value,
)

/** The card is readable on a blocked workspace's billing page, but plan
 * mutations stay gated server-side: settling the invoice comes first. */
const isAccessBlocked = computed(
	() =>
		isBlockingSubscriptionStatus(data.value?.status) &&
		!data.value?.canRecoverComplimentary &&
		!canResubscribe.value,
)
const canChangePlan = computed(
	() =>
		isTenantOwner.value &&
		!isAccessBlocked.value &&
		!data.value?.isPlanChangeLocked,
)

function day(value: string | null | undefined): string {
	return formatDate(value, locale.value, DAY_FORMAT) ?? ''
}

const pill = computed(() => {
	const subscriptionStatus = data.value?.status ?? null
	const state =
		subscriptionStatus === ACTIVE_STATUS && !isPaid.value
			? FREE_STATE
			: subscriptionStatus
	return statusView('workspace', state)
})

const summary = computed(() => {
	if (current.value?.description)
		return planDescription(current.value.description)
	const view = data.value?.available.find(
		(plan) => plan._id === current.value?._id,
	)
	if (!view || !data.value) return ''
	return data.value.features
		.filter(
			(feature) =>
				!feature.isDetailRow &&
				view.featureValues[feature.featureId] !== undefined,
		)
		.map(
			(feature) =>
				`${feature.displayName} ${formatFeatureValue(feature, view.featureValues[feature.featureId], view.currency)}`,
		)
		.join(' · ')
})

const priceLabel = computed(() => {
	const plan = current.value
	if (!plan) return ''
	const params = {
		price: formatMajorUnits(plan.price, plan.currency),
		interval: planIntervalLabel(plan.interval),
	}
	return isSeatPlan.value
		? t(`${KEY_PREFIX}.price_seat`, params)
		: t(`${KEY_PREFIX}.price_flat`, params)
})

const seatArithmetic = computed(() => {
	const plan = current.value
	if (!plan || !isSeatPlan.value || !isPaid.value) return null
	return {
		unit: formatMajorUnits(plan.price, plan.currency),
		seats: seats.value.occupied,
		total: formatMajorUnits(plan.price * seats.value.occupied, plan.currency),
		interval: planIntervalLabel(plan.interval),
	}
})

const meterSegments = computed(() => [
	{
		value: seats.value.members,
		tone: 'primary' as const,
		label: t(
			`${KEY_PREFIX}.members`,
			{ count: seats.value.members },
			seats.value.members,
		),
	},
	{
		value: seats.value.pendingInvites,
		tone: 'soft' as const,
		label: t(
			`${KEY_PREFIX}.invites`,
			{ count: seats.value.pendingInvites },
			seats.value.pendingInvites,
		),
	},
])

const seatHint = computed(() => {
	const max = current.value?.maxMembers ?? 0
	const free = Math.max(max - seats.value.occupied, 0)
	return max > 0
		? t(`${KEY_PREFIX}.seats_hint`, { used: seats.value.occupied, free })
		: t(`${KEY_PREFIX}.seats_unlimited`, { used: seats.value.occupied })
})

const facts = computed(() => {
	const plan = current.value
	if (!plan || !data.value) return []
	const items = []
	if (isPaid.value && !data.value.isComplimentary) {
		const since = day(data.value.paidUsageStartedAt)
		items.push({
			label: t(`${KEY_PREFIX}.billing`),
			value: since
				? t(`${KEY_PREFIX}.interval_since.${plan.interval}`, { date: since })
				: t(`${KEY_PREFIX}.interval.${plan.interval}`),
		})
	}
	if (data.value.status === TRIALING_STATUS && data.value.currentPeriodEnd) {
		items.push({
			label: t(`${KEY_PREFIX}.trial_until`),
			value: day(data.value.currentPeriodEnd),
		})
	} else if (
		isStripeBilled.value &&
		data.value.currentPeriodEnd &&
		!cancellationAt.value
	) {
		items.push({
			label: t(`${KEY_PREFIX}.next_renewal`),
			value: day(data.value.currentPeriodEnd),
		})
	}
	return items
})

const pastDueNote = computed(() => {
	if (data.value?.status !== PAST_DUE_STATUS) return null
	const invoice = status.value?.unpaidInvoice?.number
	return invoice
		? t(`${KEY_PREFIX}.downgrades_paused_invoice`, { invoice })
		: t(`${KEY_PREFIX}.downgrades_paused`)
})

const blockedHint = computed(() =>
	status.value?.unpaidInvoice
		? t(`${KEY_PREFIX}.blocked_hint`)
		: t(`${KEY_PREFIX}.blocked_hint_inactive`),
)

const menuItems = computed<DropdownMenuItem[][]>(() => {
	const items: DropdownMenuItem[][] = [
		[
			{
				label: t(`${KEY_PREFIX}.change`),
				icon: 'i-ph-stack',
				onSelect: () => comparison.open(),
			},
			{
				label: t(`${KEY_PREFIX}.manage_seats`),
				icon: 'i-ph-users-three',
				to: MEMBERS_PATH,
			},
		],
	]
	if (isStripeBilled.value && !cancellationAt.value) {
		items.push([
			{
				label: t(`${KEY_PREFIX}.cancel_subscription`),
				icon: 'i-ph-x-circle',
				color: 'error',
				onSelect: () => void cancelSubscription(),
			},
		])
	}
	return items
})

function openUpgrade(plan: OfferedPlanView): void {
	upgradeTarget.value = plan
	isUpgradeOpen.value = true
}

// The page's stock blocks (the complimentary banner, the next invoice) read
// the plan too: they read their routes again once it changed.
async function refresh(): Promise<void> {
	isLoading.value = true
	await Promise.all([tenantPlan.refresh(), billingStatus.refresh()])
	isLoading.value = false
	refreshPageBlocks()
}

async function runAction(
	action: () => Promise<unknown>,
	successKey: string,
): Promise<void> {
	isWorking.value = true
	try {
		await action()
		toast.add({
			title: t(successKey),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		await refresh()
	} catch (error) {
		toast.add({
			title: resolveApiError(error, 'saas.workspace.plan.change_error'),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	} finally {
		isWorking.value = false
	}
}

function cancelDowngrade(): Promise<void> {
	return runAction(
		tenantPlan.cancelPendingChange,
		`${KEY_PREFIX}.downgrade_cancelled`,
	)
}

function keepSubscription(): Promise<void> {
	return runAction(
		tenantPlan.keepSubscription,
		`${KEY_PREFIX}.subscription_kept`,
	)
}

async function cancelSubscription(): Promise<void> {
	await loadWorkspace().catch(() => undefined)
	const params = {
		workspace: workspaceName.value,
		plan: current.value?.name ?? '',
		date: day(data.value?.currentPeriodEnd),
		retention: workspace.value?.retentionDays ?? 0,
	}
	await confirm({
		title: t(`${KEY_PREFIX}.cancel_title`, params),
		description: t(`${KEY_PREFIX}.cancel_description`, params),
		color: 'error',
		icon: 'i-ph-x-circle',
		initialFocus: 'cancel',
		confirmLabel: t(`${KEY_PREFIX}.cancel_confirm`, params),
		cancelLabel: t(`${KEY_PREFIX}.cancel_keep`),
		impact: [
			{
				icon: 'i-ph-calendar',
				label: t(`${KEY_PREFIX}.cancel_access_until`),
				count: params.date,
			},
			{
				icon: 'i-ph-users-three',
				label: t(`${KEY_PREFIX}.cancel_members`, params),
				count: seats.value.members,
			},
			{
				icon: 'i-ph-database',
				label: t(`${KEY_PREFIX}.cancel_data`),
				count: t(`${KEY_PREFIX}.cancel_data_days`, params, params.retention),
			},
		],
		body: () => t(`${KEY_PREFIX}.cancel_note`),
		onConfirm: async () => {
			try {
				await tenantPlan.cancelSubscription()
			} catch (error) {
				throw new Error(
					resolveApiError(error, 'saas.workspace.plan.change_error'),
				)
			}
			toast.add({
				title: t(`${KEY_PREFIX}.cancel_scheduled`, params),
				color: 'success',
				icon: 'i-ph-check-circle',
			})
			await refresh()
		},
	})
}

/** Back from Stripe's cancel link: the checkout left behind is released
 * before the card loads, so the plan buttons work straight away. */
async function releaseCancelledCheckout(): Promise<void> {
	try {
		const { released } = await consumeCancelledCheckout()
		if (!released) return
		toast.add({
			title: t('saas.workspace.plan.checkout_pending.cancelled'),
			color: 'info',
			icon: 'i-ph-info',
		})
	} catch (error) {
		toast.add({
			title: resolveApiError(
				error,
				'saas.workspace.plan.checkout_pending.restart_error',
			),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	}
}

/**
 * `?upgrade=<planId>` (sent after registering with a paid plan) opens the
 * change on that plan's review, or on Compare when the plan is not offered.
 * The parameter is dropped either way, so a reload does not replay it.
 */
async function consumeUpgradeParam(): Promise<void> {
	const planId = readUpgradeParam(route.query)
	if (!planId) return
	const { [UPGRADE_QUERY_PARAM]: _upgrade, ...query } = route.query
	await router.replace({ query })
	if (!canChangePlan.value || !data.value) return
	const { offered } = splitOfferedPlans(
		data.value.available,
		seats.value,
		current.value?._id ?? null,
	)
	const plan = offered.find((candidate) => candidate._id === planId)
	if (!plan || plan._id === current.value?._id) {
		comparison.open()
		return
	}
	if (!isPaid.value && plan.price > 0) {
		openUpgrade(plan)
		return
	}
	comparison.openReview(plan._id)
}

/** `?choose-plan` (sent by the access-restricted screen) opens Compare. */
async function consumeChoosePlanParam(): Promise<void> {
	if (route.query[BILLING_CHOOSE_PLAN_PARAM] === undefined) return
	const { [BILLING_CHOOSE_PLAN_PARAM]: _choosePlan, ...query } = route.query
	await router.replace({ query })
	if (canChangePlan.value) comparison.open()
}

/**
 * A link to `#choose-plan` on the page (the complimentary banner's "Choose a
 * plan", a stock banner whose actions are links) opens Compare in place. The
 * click is taken before the link follows it: the router would visit the page
 * again and remount every block for an anchor.
 */
function openChoosePlanLink(event: MouseEvent): void {
	const target = event.target instanceof Element ? event.target : null
	if (!target?.closest(CHOOSE_PLAN_LINK_SELECTOR)) return
	event.preventDefault()
	event.stopPropagation()
	if (isTenantOwner.value) comparison.open()
}

onMounted(async () => {
	document.addEventListener('click', openChoosePlanLink, true)
	await releaseCancelledCheckout()
	await Promise.all([tenantPlan.load(), billingStatus.load()])
	isLoading.value = false
	await consumeUpgradeParam()
	await consumeChoosePlanParam()
})

onBeforeUnmount(() => {
	document.removeEventListener('click', openChoosePlanLink, true)
})
</script>

<template>
	<DmsCard :title="$t(`${KEY_PREFIX}.title`)">
		<template v-if="canChangePlan && current" #actions>
			<UButton
				v-if="canResubscribe"
				size="sm"
				color="primary"
				icon="i-ph-stack"
				@click="comparison.open()"
			>
				{{ $t(`${KEY_PREFIX}.resubscribe`) }}
			</UButton>
			<UButton
				v-else
				size="sm"
				:color="isPaid ? 'neutral' : 'primary'"
				:variant="isPaid ? 'subtle' : 'solid'"
				icon="i-ph-stack"
				@click="comparison.open()"
			>
				{{ isPaid ? $t(`${KEY_PREFIX}.change`) : $t(`${KEY_PREFIX}.go_paid`) }}
			</UButton>
			<UDropdownMenu :items="menuItems">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="i-ph-dots-three"
					:aria-label="$t(`${KEY_PREFIX}.more`)"
				/>
			</UDropdownMenu>
		</template>

		<div v-if="isLoading && !data" class="flex flex-col gap-3">
			<USkeleton class="h-7 w-48" />
			<USkeleton class="h-4 w-full" />
			<USkeleton class="h-2 w-full" />
		</div>

		<DmsSaasLoadFailure
			v-else-if="loadError && !data"
			:title="$t(`${KEY_PREFIX}.load_failed`)"
			@retry="refresh"
		/>

		<DmsEmptyState
			v-else-if="data && !current"
			size="sm"
			icon="i-ph-stack"
			:title="$t(`${KEY_PREFIX}.none_title`)"
			:description="$t(`${KEY_PREFIX}.none_description`)"
		/>

		<div v-else-if="data && current" class="flex flex-col gap-4">
			<div class="flex flex-wrap items-start gap-4">
				<div class="min-w-60 grow">
					<p class="flex items-center gap-2">
						<span class="text-highlighted text-lg font-semibold">
							{{ current.name }}
						</span>
						<DmsStatusPill :tone="pill.tone" :label="pill.label" />
					</p>
					<p v-if="summary" class="text-muted mt-1 text-sm">{{ summary }}</p>
				</div>
				<p class="text-highlighted text-xl font-semibold tabular-nums">
					{{ priceLabel }}
				</p>
			</div>

			<p
				v-if="seatArithmetic"
				class="flex flex-wrap items-baseline gap-2 text-sm"
			>
				<span class="tabular-nums">
					{{ $t(`${KEY_PREFIX}.per_seat`, seatArithmetic) }}
				</span>
				<span class="text-muted">×</span>
				<span class="tabular-nums">
					{{
						$t(
							`${KEY_PREFIX}.seats_billed`,
							seatArithmetic,
							seatArithmetic.seats,
						)
					}}
				</span>
				<span class="text-muted">=</span>
				<span class="font-semibold tabular-nums">
					{{ $t(`${KEY_PREFIX}.total_excl_tax`, seatArithmetic) }}
				</span>
			</p>

			<DmsMeter
				v-if="current.maxMembers > 0"
				:label="$t(`${KEY_PREFIX}.seats`)"
				:hint="seatHint"
				:max="current.maxMembers"
				:segments="meterSegments"
				legend
				:warn-at="80"
				:error-at="100"
				size="sm"
			>
				<template #legend-end>
					<ULink :to="MEMBERS_PATH" class="text-primary text-xs">
						{{ $t(`${KEY_PREFIX}.manage_members`) }}
					</ULink>
				</template>
			</DmsMeter>
			<p v-else class="text-muted text-sm">{{ seatHint }}</p>

			<DmsKeyValueList v-if="facts.length" :items="facts" :columns="2" dense />

			<DmsBanner
				v-if="pendingPlan"
				size="sm"
				tone="warning"
				icon="i-ph-calendar"
				:title="
					$t(`${KEY_PREFIX}.pending_downgrade`, {
						plan: pendingPlan.planName,
						date: day(pendingPlan.effectiveAt),
					})
				"
			>
				<template v-if="isTenantOwner" #actions>
					<UButton
						size="xs"
						color="neutral"
						variant="outline"
						:loading="isWorking"
						@click="cancelDowngrade"
					>
						{{ $t(`${KEY_PREFIX}.cancel_downgrade`) }}
					</UButton>
				</template>
			</DmsBanner>

			<DmsBanner
				v-if="cancellationAt"
				size="sm"
				tone="error"
				icon="i-ph-calendar-x"
				:title="
					$t(`${KEY_PREFIX}.cancels_on`, {
						plan: current.name,
						date: day(cancellationAt),
					})
				"
				:description="$t(`${KEY_PREFIX}.cancels_hint`)"
			>
				<template v-if="isTenantOwner" #actions>
					<UButton
						size="xs"
						color="neutral"
						variant="outline"
						:loading="isWorking"
						@click="keepSubscription"
					>
						{{ $t(`${KEY_PREFIX}.keep_subscription`) }}
					</UButton>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						:to="DATA_EXPORT_PATH"
					>
						{{ $t(`${KEY_PREFIX}.export_data`) }}
					</UButton>
				</template>
			</DmsBanner>

			<p v-if="pastDueNote && !isAccessBlocked" class="text-muted text-sm">
				<UIcon name="i-ph-info" class="me-1 align-middle" />
				{{ pastDueNote }}
			</p>
			<p v-if="canResubscribe && isTenantOwner" class="text-muted text-sm">
				{{ $t(`${KEY_PREFIX}.resubscribe_hint`) }}
			</p>
			<p v-else-if="isAccessBlocked" class="text-muted text-sm">
				{{ blockedHint }}
			</p>
			<p v-else-if="data.isPlanChangeLocked" class="text-muted text-sm">
				{{ $t(`${KEY_PREFIX}.managed`) }}
			</p>
			<p v-else-if="!isTenantOwner" class="text-muted text-sm">
				{{
					status?.workspaceOwner
						? $t(`${KEY_PREFIX}.owner_changes_named`, {
								owner: status.workspaceOwner.name,
							})
						: $t(`${KEY_PREFIX}.owner_changes`)
				}}
			</p>
		</div>

		<DmsSaasPlanComparisonModal
			v-if="data && isTenantOwner"
			:plans="data.available"
			:features="data.features"
			:seats="seats"
			:current-plan-id="current?._id ?? null"
			:current-plan-name="current?.name ?? null"
			:pending-plan-id="pendingPlan?.planId ?? null"
			:renewal-date="data.currentPeriodEnd"
			:is-recovery="data.canRecoverComplimentary"
			:is-resubscription="canResubscribe"
			:is-current-paid="isPaid && !!status?.hasStripeCustomer && !canResubscribe"
			:workspace-name="workspaceName"
			@changed="refresh"
			@upgrade="openUpgrade"
		/>
		<DmsSaasPlanUpgradeModal
			v-if="isTenantOwner"
			v-model:open="isUpgradeOpen"
			:plan="upgradeTarget"
			:workspace-name="workspaceName"
			@changed="refresh"
		/>
		<DmsSaasPendingCheckoutModal v-if="isTenantOwner" />
	</DmsCard>
</template>
