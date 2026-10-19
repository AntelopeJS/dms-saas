<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LABEL_DAY_FORMAT, SENTENCE_DAY_FORMAT } from './day-formats'
import { planChangeHeadingCase, targetPlanEyebrow } from './plan-change-heading'

interface SummaryRow {
	key: string
	label: string
	amount: string
	isTotal?: boolean
}

const props = defineProps<{
	plan: OfferedPlanView
	currentPlan: OfferedPlanView | null
	currentPlanName: string | null
	features: TenantPlanFeature[]
	allowBack: boolean
	/** The workspace was cancelled: choosing a plan reopens it. */
	isResubscription?: boolean
}>()

const emit = defineEmits<{ back: []; done: [] }>()

const KEY_PREFIX = 'saas.tenant_billing.plan_change.review'

const { t, locale } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()
const { previewChange, changePlan } = useTenantPlanChanges()
const { offerFor: offerPendingCheckout } = usePendingCheckout()
const { formatMinorUnits, formatMajorUnits } = useMoneyFormat()
const { formatFeatureValue } = usePlanFeatureFormat()
const { data: billingStatus } = useBillingStatus()
const planIntervalLabel = usePlanIntervalLabel('saas.workspace.plan.interval')

const preview = ref<PlanChangePreview | null>(null)
const isLoading = ref(true)
const loadFailure = ref<string | null>(null)
/** What the workspace holds beyond the target plan: the change is refused until it is brought within. */
const incompatibilities = ref<PlanChangeIncompatibility[] | null>(null)
const isSubmitting = ref(false)
const submitFailure = ref<string | null>(null)

const isDowngrade = computed(() => preview.value?.kind === 'downgrade')
const isFreeSwitch = computed(() => preview.value?.kind === 'free')
const charge = computed(() => preview.value?.charge ?? null)
const currency = computed(() => preview.value?.currency ?? props.plan.currency)
const card = computed(() => billingStatus.value?.paymentMethod ?? null)
const diff = computed(() =>
	diffPlanFeatures(props.features, props.currentPlan, props.plan),
)

function day(value: string | null | undefined): string {
	return formatDate(value, locale.value, LABEL_DAY_FORMAT) ?? ''
}

function sentenceDay(value: string | null | undefined): string {
	return formatDate(value, locale.value, SENTENCE_DAY_FORMAT) ?? ''
}

function money(minorUnits: number | null | undefined): string {
	return formatMinorUnits(minorUnits, currency.value)
}

function featureValue(feature: TenantPlanFeature, value: unknown): string {
	return formatFeatureValue(feature, value, props.plan.currency)
}

function priceOf(plan: OfferedPlanView | null): string {
	if (!plan) return '—'
	const price = formatMajorUnits(plan.price, plan.currency)
	return plan.billingMode === 'seat'
		? t(`${KEY_PREFIX}.price_per_seat`, { price })
		: t(`${KEY_PREFIX}.price_flat`, {
				price,
				interval: planIntervalLabel(plan.interval),
			})
}

const dueToday = computed(() => {
	if (isDowngrade.value || preview.value?.isTrial) return 0
	return charge.value?.amountDueMinorUnits ?? null
})

const headingCase = computed(() =>
	incompatibilities.value
		? 'incompatible'
		: planChangeHeadingCase(
				preview.value,
				props.currentPlan,
				props.plan,
				props.isResubscription,
			),
)

const targetEyebrow = computed(() => {
	const eyebrow = targetPlanEyebrow(preview.value, !!incompatibilities.value)
	if (eyebrow === 'from_date')
		return t(`${KEY_PREFIX}.from_date`, {
			date: day(preview.value?.effectiveAt),
		})
	return eyebrow ? t(`${KEY_PREFIX}.${eyebrow}`) : null
})

const heading = computed(() => {
	const params = {
		plan: props.plan.name,
		current: props.currentPlanName ?? '',
		date: sentenceDay(preview.value?.effectiveAt),
		trialEnd: sentenceDay(preview.value?.trialEndsAt),
	}
	return {
		title: t(`${KEY_PREFIX}.${headingCase.value}_title`, params),
		description: t(`${KEY_PREFIX}.${headingCase.value}_description`, params),
	}
})

// During a trial the lines are what the first invoice will bill, not what is
// due today: their eyebrow says when they are charged.
const linesEyebrow = computed(() => {
	if (isDowngrade.value) return t(`${KEY_PREFIX}.charged_today`)
	if (preview.value?.isTrial)
		return t(`${KEY_PREFIX}.trial_lines`, {
			date: day(preview.value.trialEndsAt),
		})
	return t(`${KEY_PREFIX}.due_today`)
})

const chargeRows = computed<SummaryRow[]>(() => {
	const priced = charge.value
	if (!priced || isDowngrade.value) return []
	const lines = priced.lines.map((line, index) => ({
		key: `line-${index}`,
		label: line.description ?? t(`${KEY_PREFIX}.line`),
		amount: money(line.amountMinorUnits),
	}))
	const taxes = priced.taxes.map((tax, index) => ({
		key: `tax-${index}`,
		label: t(`${KEY_PREFIX}.tax`, {
			rate: tax.ratePercentage === null ? '' : `${tax.ratePercentage}%`,
			country: tax.country ?? '',
		}),
		amount: money(tax.amountMinorUnits),
	}))
	return [
		...lines,
		{
			key: 'subtotal',
			label: t(`${KEY_PREFIX}.subtotal`),
			amount: money(priced.subtotalMinorUnits),
		},
		...taxes,
	]
})

const renewalSentence = computed(() => {
	const current = preview.value
	if (!current) return ''
	return t(`${KEY_PREFIX}.renewal`, {
		amount: money(current.renewal.amountExcludingTaxMinorUnits),
		date: sentenceDay(current.renewal.at),
		interval: planIntervalLabel(current.renewal.interval),
	})
})

const confirmLabel = computed(() => {
	if (isDowngrade.value) return t(`${KEY_PREFIX}.confirm_downgrade`)
	if (headingCase.value === 'resubscribe')
		return t(`${KEY_PREFIX}.confirm_resubscribe`, { plan: props.plan.name })
	if (isFreeSwitch.value)
		return t(`${KEY_PREFIX}.confirm_free`, { plan: props.plan.name })
	if (preview.value?.isTrial)
		return t(`${KEY_PREFIX}.confirm_trial`, { plan: props.plan.name })
	if (headingCase.value === 'same_price')
		return t(`${KEY_PREFIX}.confirm_same_price`, {
			plan: props.plan.name,
			amount: money(dueToday.value),
		})
	return t(`${KEY_PREFIX}.confirm_upgrade`, { amount: money(dueToday.value) })
})

const canConfirm = computed(
	() =>
		!!preview.value &&
		(isDowngrade.value || preview.value.isChargeAvailable) &&
		!isSubmitting.value,
)

async function loadPreview(): Promise<void> {
	isLoading.value = true
	loadFailure.value = null
	incompatibilities.value = null
	try {
		preview.value = await previewChange(props.plan._id)
	} catch (error) {
		preview.value = null
		incompatibilities.value = readPlanChangeIncompatibilities(error)
		if (!incompatibilities.value) {
			loadFailure.value = resolveApiError(error, `${KEY_PREFIX}.load_failed`)
		}
	} finally {
		isLoading.value = false
	}
}

async function confirm(): Promise<void> {
	isSubmitting.value = true
	submitFailure.value = null
	try {
		const result = await changePlan(
			props.plan._id,
			preview.value?.prorationDate,
		)
		toast.add({
			title: result.scheduled
				? t(`${KEY_PREFIX}.scheduled`, {
						date: sentenceDay(result.effectiveAt),
					})
				: t(`${KEY_PREFIX}.applied`, { plan: props.plan.name }),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		emit('done')
	} catch (error) {
		if (await offerPendingCheckout(error, props.plan._id)) return
		// The inventory changed between the review and the confirmation.
		incompatibilities.value = readPlanChangeIncompatibilities(error)
		if (incompatibilities.value) {
			preview.value = null
			return
		}
		submitFailure.value = resolveApiError(
			error,
			'saas.workspace.plan.change_error',
		)
	} finally {
		isSubmitting.value = false
	}
}

onMounted(() => void loadPreview())
</script>

<template>
	<div class="flex flex-col gap-5">
		<div>
			<h3 class="text-highlighted text-base font-semibold">
				{{ heading.title }}
			</h3>
			<p class="text-muted text-sm">{{ heading.description }}</p>
		</div>

		<div class="grid gap-2 sm:grid-cols-2">
			<DmsCard :padded="true">
				<p class="text-muted text-xs">
					{{
						isDowngrade
							? $t(`${KEY_PREFIX}.until`, { date: day(preview?.effectiveAt) })
							: $t(`${KEY_PREFIX}.now`)
					}}
				</p>
				<p class="font-semibold">{{ currentPlanName ?? '—' }}</p>
				<p class="text-muted text-sm">{{ priceOf(currentPlan) }}</p>
			</DmsCard>
			<DmsCard :padded="true" selected>
				<p v-if="targetEyebrow" class="text-muted text-xs">
					{{ targetEyebrow }}
				</p>
				<p class="font-semibold">{{ plan.name }}</p>
				<p class="text-muted text-sm">{{ priceOf(plan) }}</p>
			</DmsCard>
		</div>

		<div
			v-if="diff.gained.length || diff.lost.length"
			class="grid gap-3 sm:grid-cols-2"
		>
			<div v-if="diff.gained.length">
				<p class="text-success mb-1 text-xs font-semibold">
					{{ $t(`${KEY_PREFIX}.gained`) }}
				</p>
				<ul class="flex flex-col gap-1 text-sm">
					<li v-for="change in diff.gained" :key="change.feature.featureId">
						<UIcon
							name="i-ph-plus-circle"
							class="text-success me-1 align-middle"
						/>
						{{ change.feature.displayName }}:
						{{ featureValue(change.feature, change.to) }}
						<span class="text-muted">
							{{
								$t(`${KEY_PREFIX}.was`, {
									value: featureValue(change.feature, change.from),
								})
							}}
						</span>
					</li>
				</ul>
			</div>
			<div v-if="diff.lost.length">
				<p class="text-warning mb-1 text-xs font-semibold">
					{{ $t(`${KEY_PREFIX}.lost`) }}
				</p>
				<ul class="flex flex-col gap-1 text-sm">
					<li v-for="change in diff.lost" :key="change.feature.featureId">
						<UIcon
							name="i-ph-minus-circle"
							class="text-warning me-1 align-middle"
						/>
						{{ change.feature.displayName }}:
						{{ featureValue(change.feature, change.to) }}
						<span class="text-muted">
							{{
								$t(`${KEY_PREFIX}.was`, {
									value: featureValue(change.feature, change.from),
								})
							}}
						</span>
					</li>
				</ul>
			</div>
		</div>

		<div v-if="isLoading" class="flex flex-col gap-2">
			<USkeleton class="h-4 w-full" />
			<USkeleton class="h-4 w-full" />
			<USkeleton class="h-6 w-1/2" />
		</div>

		<UAlert
			v-else-if="incompatibilities"
			color="warning"
			variant="subtle"
			icon="i-ph-prohibit"
			:title="$t(`${KEY_PREFIX}.incompatible_list`, { plan: plan.name })"
		>
			<template #description>
				<ul class="flex list-disc flex-col gap-1 ps-4">
					<li
						v-for="(issue, index) in incompatibilities"
						:key="`${issue.code}-${issue.resource ?? index}`"
					>
						{{ issue.message }}
					</li>
				</ul>
			</template>
			<template #actions>
				<UButton
					color="warning"
					variant="soft"
					size="xs"
					icon="i-ph-arrow-clockwise"
					@click="loadPreview"
				>
					{{ $t(`${KEY_PREFIX}.check_again`) }}
				</UButton>
			</template>
		</UAlert>

		<UAlert
			v-else-if="loadFailure"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:title="loadFailure"
		>
			<template #actions>
				<UButton
					color="error"
					variant="soft"
					size="xs"
					icon="i-ph-arrow-clockwise"
					@click="loadPreview"
				>
					{{ $t('saas.common.retry') }}
				</UButton>
			</template>
		</UAlert>

		<div
			v-else-if="preview && !isFreeSwitch"
			class="flex flex-col gap-2 text-sm"
		>
			<p class="text-muted text-xs font-semibold uppercase">
				{{ linesEyebrow }}
			</p>
			<div
				v-for="row in chargeRows"
				:key="row.key"
				class="flex justify-between gap-4"
			>
				<span>{{ row.label }}</span>
				<span class="tabular-nums">{{ row.amount }}</span>
			</div>
			<UAlert
				v-if="!isDowngrade && !preview.isChargeAvailable"
				color="warning"
				variant="subtle"
				icon="i-ph-warning"
				:title="$t(`${KEY_PREFIX}.unpriced`)"
			/>
			<div
				class="border-default flex justify-between gap-4 border-t pt-2 font-semibold"
			>
				<span>{{ $t(`${KEY_PREFIX}.total_today`) }}</span>
				<span class="tabular-nums">{{ money(dueToday) }}</span>
			</div>
			<p v-if="preview.isTrial" class="text-muted">
				{{
					$t(`${KEY_PREFIX}.trial`, {
						date: sentenceDay(preview.trialEndsAt),
					})
				}}
			</p>
			<p class="text-muted">{{ renewalSentence }}</p>
			<p v-if="isDowngrade" class="text-muted">
				<UIcon name="i-ph-info" class="me-1 align-middle" />
				{{
					$t(`${KEY_PREFIX}.cancel_any_time`, {
						date: sentenceDay(preview.effectiveAt),
					})
				}}
			</p>
			<p v-if="card && !isDowngrade" class="text-muted text-xs">
				<UIcon name="i-ph-credit-card" class="me-1 align-middle" />
				{{ formatCardLabel(card) }}
			</p>
		</div>

		<UAlert
			v-if="submitFailure"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:title="submitFailure"
		/>

		<div class="flex justify-end gap-2">
			<UButton
				v-if="allowBack"
				color="neutral"
				variant="ghost"
				icon="i-ph-arrow-left"
				@click="emit('back')"
			>
				{{ $t(`${KEY_PREFIX}.back`) }}
			</UButton>
			<UButton
				v-if="!incompatibilities"
				:color="isDowngrade ? 'warning' : 'primary'"
				:icon="isDowngrade ? 'i-ph-calendar-check' : 'i-ph-lock-simple'"
				:disabled="!canConfirm"
				:loading="isSubmitting"
				@click="confirm"
			>
				{{ confirmLabel }}
			</UButton>
		</div>
	</div>
</template>
