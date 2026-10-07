<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PlanChangeReview from '../build/PlanChangeReview.vue'
import type { PlanInterval } from '../composables/usePlanIntervalLabel'

const props = defineProps<{
	plans: OfferedPlanView[]
	features: TenantPlanFeature[]
	seats: SeatsInUse
	currentPlanId: string | null
	currentPlanName: string | null
	pendingPlanId: string | null
	renewalDate: string | null
	isRecovery?: boolean
	/** A paid plan chosen from a free one goes through the upgrade flow. */
	isCurrentPaid?: boolean
	workspaceName?: string | null
}>()

const emit = defineEmits<{ changed: []; upgrade: [plan: OfferedPlanView] }>()

const KEY_PREFIX = 'saas.tenant_billing.plan_change'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { isOpen: open, reviewPlanId } = usePlanComparison()
const { t, locale } = useI18n()
const { formatFeatureValue } = usePlanFeatureFormat()
const { formatMajorUnits } = useMoneyFormat()
const planIntervalLabel = usePlanIntervalLabel('saas.workspace.plan.interval')

const showDetailRows = ref(false)
const interval = ref<PlanInterval>('month')

const currentPlan = computed(
	() => props.plans.find((plan) => plan._id === props.currentPlanId) ?? null,
)
const intervals = computed<PlanInterval[]>(() => [
	...new Set(props.plans.map((plan) => plan.interval)),
])
const split = computed(() =>
	splitOfferedPlans(props.plans, props.seats, props.currentPlanId),
)
const columns = computed(() =>
	split.value.offered.filter(
		(plan) => intervals.value.length < 2 || plan.interval === interval.value,
	),
)
const reviewedPlan = computed(
	() => props.plans.find((plan) => plan._id === reviewPlanId.value) ?? null,
)

const comparedFeatures = computed(() =>
	props.features.filter((feature) =>
		columns.value.some(
			(plan) => plan.featureValues[feature.featureId] !== undefined,
		),
	),
)
const visibleFeatures = computed(() =>
	comparedFeatures.value.filter(
		(feature) => showDetailRows.value || !feature.isDetailRow,
	),
)
const hiddenDetailCount = computed(
	() => comparedFeatures.value.filter((feature) => feature.isDetailRow).length,
)

const tooSmallNote = computed(() => {
	const names = split.value.tooSmall.map((plan) => plan.name)
	if (!names.length) return null
	return t(`${KEY_PREFIX}.too_small`, {
		plans: names.join(', '),
		seats: props.seats.occupied,
		workspace: props.workspaceName ?? '',
	})
})

const subtitle = computed(() =>
	t(`${KEY_PREFIX}.subtitle`, {
		workspace: props.workspaceName ?? '',
		plan: props.currentPlanName ?? '—',
		seats: props.seats.occupied,
		members: props.seats.members,
		invites: props.seats.pendingInvites,
	}),
)

function isCurrent(plan: OfferedPlanView): boolean {
	return plan._id === props.currentPlanId && !props.isRecovery
}

function isDowngradeTarget(plan: OfferedPlanView): boolean {
	return isPlanDowngrade(
		currentPlan.value,
		plan,
		!!props.isCurrentPaid,
		props.seats.occupied,
	)
}

function priceLine(plan: OfferedPlanView): string {
	const price = formatMajorUnits(plan.price, plan.currency)
	const period = planIntervalLabel(plan.interval)
	return plan.billingMode === 'seat'
		? t(`${KEY_PREFIX}.price_seat`, { price, interval: period })
		: t(`${KEY_PREFIX}.price_flat`, { price, interval: period })
}

function seatTotal(plan: OfferedPlanView): string | null {
	if (plan.billingMode !== 'seat') return null
	return t(`${KEY_PREFIX}.seat_total`, {
		total: formatMajorUnits(plan.price * props.seats.occupied, plan.currency),
		seats: props.seats.occupied,
	})
}

function seatsCell(plan: OfferedPlanView): string {
	return plan.maxMembers > 0
		? String(plan.maxMembers)
		: t(`${KEY_PREFIX}.unlimited`)
}

function actionLabel(plan: OfferedPlanView): string {
	if (props.isRecovery || !props.isCurrentPaid) return t(`${KEY_PREFIX}.choose`)
	return isDowngradeTarget(plan)
		? t(`${KEY_PREFIX}.review_downgrade`)
		: t(`${KEY_PREFIX}.review_upgrade`)
}

function needsCheckout(plan: OfferedPlanView): boolean {
	return !props.isCurrentPaid && plan.price > 0
}

function select(plan: OfferedPlanView): void {
	if (needsCheckout(plan)) {
		open.value = false
		emit('upgrade', plan)
		return
	}
	reviewPlanId.value = plan._id
}

function finishReview(): void {
	open.value = false
	emit('changed')
}

const footnote = computed(() =>
	t(`${KEY_PREFIX}.timing`, {
		date: formatDate(props.renewalDate, locale.value, DAY_FORMAT) ?? '—',
	}),
)

// A review asked for a plan that needs Stripe's payment page goes there.
watch(
	[open, reviewedPlan],
	([isOpen, plan]) => {
		if (isOpen && plan && needsCheckout(plan)) select(plan)
	},
	{ immediate: true },
)

watch(open, (isOpen) => {
	if (isOpen)
		interval.value =
			currentPlan.value?.interval ?? intervals.value[0] ?? 'month'
	else reviewPlanId.value = null
})
</script>

<template>
	<UModal
		v-model:open="open"
		:title="
			reviewedPlan
				? $t(`${KEY_PREFIX}.review_title`)
				: $t(`${KEY_PREFIX}.title`)
		"
		:description="reviewedPlan ? undefined : subtitle"
		:ui="{ content: reviewedPlan ? 'max-w-xl' : 'max-w-5xl' }"
	>
		<template #body>
			<PlanChangeReview
				v-if="reviewedPlan"
				:key="reviewedPlan._id"
				:plan="reviewedPlan"
				:current-plan="currentPlan"
				:current-plan-name="currentPlanName"
				:features="features"
				allow-back
				@back="reviewPlanId = null"
				@done="finishReview"
			/>

			<div v-else class="flex flex-col gap-4">
				<UTabs
					v-if="intervals.length > 1"
					v-model="interval"
					:items="
						intervals.map((value) => ({
							label: $t(`${KEY_PREFIX}.interval.${value}`),
							value,
						}))
					"
					:content="false"
					size="sm"
					class="self-start"
				/>

				<DmsEmptyState
					v-if="!columns.length"
					size="sm"
					:title="$t(`${KEY_PREFIX}.none_title`)"
					:description="$t(`${KEY_PREFIX}.none_description`)"
				/>

				<div v-else class="overflow-x-auto">
					<table class="min-w-3xl w-full border-collapse text-sm">
						<thead>
							<tr>
								<th class="w-48 p-3 text-left align-bottom">
									<span class="text-muted text-xs font-normal">
										{{
											$t(`${KEY_PREFIX}.for_seats`, { seats: seats.occupied })
										}}
									</span>
								</th>
								<th
									v-for="plan in columns"
									:key="plan._id"
									scope="col"
									class="border-default border-b p-3 text-left align-top"
									:class="isCurrent(plan) ? 'bg-primary/5' : ''"
								>
									<div class="flex flex-col gap-1">
										<span class="flex items-center gap-2 font-semibold">
											{{ plan.name }}
											<DmsStatusPill
												v-if="isCurrent(plan)"
												tone="primary"
												size="sm"
												:label="$t(`${KEY_PREFIX}.current`)"
											/>
										</span>
										<span class="tabular-nums">{{ priceLine(plan) }}</span>
										<span v-if="seatTotal(plan)" class="text-muted text-xs">
											{{ seatTotal(plan) }}
										</span>
										<UBadge
											v-if="plan.trialDays > 0 && !isCurrent(plan)"
											color="info"
											variant="subtle"
											size="sm"
											class="self-start"
										>
											{{
												$t(`${KEY_PREFIX}.trial_days`, { days: plan.trialDays })
											}}
										</UBadge>
										<UButton
											v-if="isCurrent(plan)"
											size="xs"
											color="neutral"
											variant="subtle"
											disabled
											class="mt-1 self-start"
										>
											{{ $t(`${KEY_PREFIX}.your_plan`) }}
										</UButton>
										<UButton
											v-else-if="plan._id === pendingPlanId"
											size="xs"
											color="warning"
											variant="subtle"
											disabled
											class="mt-1 self-start"
										>
											{{ $t(`${KEY_PREFIX}.scheduled`) }}
										</UButton>
										<UButton
											v-else
											size="xs"
											:color="isDowngradeTarget(plan) ? 'neutral' : 'primary'"
											:variant="isDowngradeTarget(plan) ? 'subtle' : 'solid'"
											:disabled="isRecovery && !plan.checkoutAvailable"
											class="mt-1 self-start"
											@click="select(plan)"
										>
											{{ actionLabel(plan) }}
										</UButton>
									</div>
								</th>
							</tr>
						</thead>
						<tbody>
							<tr class="border-default border-b">
								<th scope="row" class="p-3 text-left font-normal">
									{{ $t(`${KEY_PREFIX}.seats_row`) }}
								</th>
								<td
									v-for="plan in columns"
									:key="plan._id"
									class="p-3 tabular-nums"
									:class="isCurrent(plan) ? 'bg-primary/5' : ''"
								>
									{{ seatsCell(plan) }}
								</td>
							</tr>
							<tr
								v-for="feature in visibleFeatures"
								:key="feature.featureId"
								class="border-default border-b last:border-0"
							>
								<th scope="row" class="p-3 text-left font-normal">
									<span class="inline-flex items-center gap-1">
										{{ feature.displayName }}
										<UTooltip v-if="feature.tooltip" :text="feature.tooltip">
											<UIcon name="i-ph-info" class="text-muted size-3.5" />
										</UTooltip>
									</span>
								</th>
								<td
									v-for="plan in columns"
									:key="plan._id"
									class="p-3 tabular-nums"
									:class="isCurrent(plan) ? 'bg-primary/5' : ''"
								>
									{{
										formatFeatureValue(
											feature,
											plan.featureValues[feature.featureId],
											plan.currency,
										)
									}}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<UButton
					v-if="hiddenDetailCount"
					variant="link"
					color="primary"
					class="self-center"
					:icon="showDetailRows ? 'i-ph-caret-up' : 'i-ph-caret-down'"
					@click="showDetailRows = !showDetailRows"
				>
					{{
						showDetailRows
							? $t(`${KEY_PREFIX}.hide_detail`)
							: $t(
									`${KEY_PREFIX}.show_detail`,
									{ count: hiddenDetailCount },
									hiddenDetailCount,
								)
					}}
				</UButton>

				<p v-if="tooSmallNote" class="text-muted text-sm">
					<UIcon name="i-ph-info" class="me-1 align-middle" />
					{{ tooSmallNote }}
				</p>
				<p v-if="isCurrentPaid" class="text-muted text-sm">
					<UIcon name="i-ph-calendar" class="me-1 align-middle" />
					{{ footnote }}
				</p>
			</div>
		</template>
	</UModal>
</template>
