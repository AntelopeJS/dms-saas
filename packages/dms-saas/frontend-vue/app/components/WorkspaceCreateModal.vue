<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import FormFieldRow from '../build/components/FormFieldRow.vue'
import FormRows from '../build/components/FormRows.vue'

/** What choosing a plan asks for, as `GET create-options` words it. */
type CardRequirement = 'none' | 'payment' | 'verification'

interface CreatePlanOption extends PricedPlan {
	_id: string
	name: string
	description: string
	trialDays: number
	maxMembers: number
	cardRequirement: CardRequirement
}

interface FreePerCardRule {
	limit: number
	usedBy: string[]
}

interface CreateOptions {
	plans: CreatePlanOption[]
	freePerCard: FreePerCardRule | null
}

interface ConfirmedPayment {
	isConfirmed: boolean
	paymentMethodId?: string
}

interface CreatedWorkspace {
	tenantId: string
}

interface SetupIntent {
	clientSecret: string
}

const props = defineProps<{
	onSuccessCallback?: (tenantId: string, name: string) => void
	onCancelCallback?: () => void
}>()

const OPTIONS_ENDPOINT = '/api/saas/workspaces/create-options'
const SETUP_INTENT_ENDPOINT = '/api/saas/workspaces/setup-intent'
const CREATE_ENDPOINT = '/api/saas/workspaces'
const PAYMENT_ELEMENT_ID = 'dms-saas-workspace-create-payment-element'
const NAME_MAX_LENGTH = 60
const KEYS = 'saas.workspace.create'
const MS_PER_DAY = 86_400_000
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
/** Server refusals about the card, shown under the card field. */
const CARD_ERROR_KEYS = new Set([
	'saas.errors.workspace.payment_method_required',
	'saas.errors.workspace.free_card_limit_reached',
	'saas.errors.workspace.creation_in_progress',
	'saas.errors.billing.country_required',
])

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const { resolveApiError } = useApiErrorMessage()
const { formatMajorUnits } = useMoneyFormat()
const planPriceLabel = usePlanPriceLabel()
const planIntervalLabel = usePlanIntervalLabel(`${KEYS}.interval`)
const planDescription = usePlanDescription()
const config = useDmsRuntimeConfig()
const { user } = useCurrentUser()

const workspaceName = ref('')
const options = ref<CreateOptions | null>(null)
const selectedPlanId = ref<string | null>(null)
const isLoading = ref(true)
const isSubmitting = ref(false)
const loadError = ref<string | null>(null)
const nameError = ref<string | null>(null)
const cardError = ref<string | null>(null)
const submitError = ref<string | null>(null)
const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
	null,
)
let cardSetup: Promise<void> | null = null

const publishableKey = computed<string>(
	() =>
		(config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
			?.stripePublishableKey ?? '',
)
const plans = computed(() => options.value?.plans ?? [])
const selectedPlan = computed(
	() => plans.value.find((plan) => plan._id === selectedPlanId.value) ?? null,
)
const requirement = computed<CardRequirement>(
	() => selectedPlan.value?.cardRequirement ?? 'none',
)
const asksForCard = computed(() => requirement.value !== 'none')
const hasNoPlan = computed(() => !!options.value && plans.value.length === 0)

const submitLabel = computed(() => {
	const name = workspaceName.value.trim()
	if (!name || !selectedPlan.value) return t(`${KEYS}.submit`)
	return t(`${KEYS}.submit_named`, { name, plan: selectedPlan.value.name })
})

const cardBadge = computed(() =>
	requirement.value === 'verification'
		? t(`${KEYS}.card.verification_only`)
		: t(`${KEYS}.card.required_for`, { plan: selectedPlan.value?.name ?? '' }),
)

const chargeSentence = computed(() => {
	const plan = selectedPlan.value
	if (!plan || requirement.value !== 'payment') return null
	const price = formatMajorUnits(plan.price, plan.currency)
	if (plan.trialDays <= 0) {
		return t(`${KEYS}.charge.today`, {
			price,
			interval: planIntervalLabel(plan.interval),
		})
	}
	const firstCharge = new Date(Date.now() + plan.trialDays * MS_PER_DAY)
	return t(`${KEYS}.charge.after_trial`, {
		zero: formatMajorUnits(0, plan.currency),
		price,
		date: formatDate(firstCharge, locale.value, DATE_FORMAT),
	})
})

function planMeta(plan: CreatePlanOption): string {
	const rule = options.value?.freePerCard
	if (plan.cardRequirement === 'verification' && rule?.usedBy.length) {
		return t(
			`${KEYS}.free_per_card_used`,
			{ limit: rule.limit, workspaces: rule.usedBy.join(', ') },
			rule.limit,
		)
	}
	const parts = [planDescription(plan.description)].filter(Boolean)
	if (plan.trialDays > 0 && plan.cardRequirement === 'payment') {
		parts.push(t(`${KEYS}.trial`, { days: plan.trialDays }))
	}
	return parts.join(' · ')
}

function selectPlan(plan: CreatePlanOption): void {
	selectedPlanId.value = plan._id
	cardError.value = null
	submitError.value = null
}

async function initStripeElement(): Promise<void> {
	if (!publishableKey.value) {
		// A missing key would render an empty card box and fail every submit
		// with a generic payment error, reading as the visitor's fault.
		cardError.value = t(`${KEYS}.error.card_setup`)
		return
	}
	const setup = await $authFetch<SetupIntent>(SETUP_INTENT_ENDPOINT)
	stripeHandle.value = useStripePaymentElement({
		publishableKey: publishableKey.value,
		clientSecret: setup.clientSecret,
		containerId: PAYMENT_ELEMENT_ID,
		billingEmail: () => user.value?.email ?? '',
	})
}

// Set up once, on the first plan that asks for a card, then only hidden:
// switching plans keeps the card already typed in.
async function setUpCard(): Promise<void> {
	await nextTick()
	try {
		await initStripeElement()
	} catch (error) {
		cardSetup = null
		cardError.value = resolveApiError(error, `${KEYS}.error.card_setup`)
	}
}

function ensureCardStep(): Promise<void> {
	if (!asksForCard.value) return Promise.resolve()
	cardSetup ??= setUpCard()
	return cardSetup
}

watch(asksForCard, ensureCardStep)

async function load(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		options.value = await $authFetch<CreateOptions>(OPTIONS_ENDPOINT)
		selectedPlanId.value ??= options.value.plans[0]?._id ?? null
	} catch (error) {
		loadError.value = resolveApiError(error, `${KEYS}.error.load_description`)
	} finally {
		isLoading.value = false
	}
	// Kept apart so a card-setup outage reports itself as such instead of
	// hiding behind "could not load the plans".
	await ensureCardStep()
}

function validate(): boolean {
	const name = workspaceName.value.trim()
	nameError.value = name ? null : t(`${KEYS}.error.name`)
	if (nameError.value) return false
	if (asksForCard.value && !stripeHandle.value) {
		cardError.value ??= t(`${KEYS}.error.card_setup`)
		return false
	}
	return !!selectedPlan.value
}

async function confirmCard(): Promise<ConfirmedPayment> {
	if (!asksForCard.value) return { isConfirmed: true }
	const confirmed = await stripeHandle.value?.confirmAndGetPaymentMethod()
	if (confirmed?.paymentMethodId) {
		return { isConfirmed: true, paymentMethodId: confirmed.paymentMethodId }
	}
	cardError.value = confirmed?.error?.message ?? t(`${KEYS}.error.card`)
	return { isConfirmed: false }
}

function reportSubmitError(error: unknown): void {
	const message = resolveApiError(error, `${KEYS}.error.failed`)
	if (CARD_ERROR_KEYS.has(readApiErrorKey(error) ?? '')) {
		cardError.value = message
		return
	}
	submitError.value = message
}

async function submit(): Promise<void> {
	if (isSubmitting.value || !validate()) return
	cardError.value = null
	submitError.value = null
	isSubmitting.value = true
	try {
		const payment = await confirmCard()
		if (!payment.isConfirmed) return
		const name = workspaceName.value.trim()
		const created = await $authFetch<CreatedWorkspace>(CREATE_ENDPOINT, {
			method: 'POST',
			body: {
				workspaceName: name,
				planId: selectedPlanId.value,
				paymentMethodId: payment.paymentMethodId,
			},
		})
		props.onSuccessCallback?.(created.tenantId, name)
	} catch (error) {
		reportSubmitError(error)
	} finally {
		isSubmitting.value = false
	}
}

onMounted(load)
</script>

<template>
	<div v-if="isLoading" class="flex flex-col gap-3" aria-busy="true">
		<USkeleton class="h-10 w-full" />
		<USkeleton v-for="row in 3" :key="row" class="h-14 w-full" />
	</div>

	<DmsEmptyState
		v-else-if="loadError"
		variant="error"
		size="sm"
		:title="$t(`${KEYS}.error.load`)"
		:description="loadError"
		:actions="[
			{
				label: $t('saas.common.retry'),
				icon: 'i-ph-arrow-clockwise',
				color: 'neutral',
				variant: 'outline',
				onClick: load,
			},
		]"
	/>

	<DmsEmptyState
		v-else-if="hasNoPlan"
		size="sm"
		icon="i-ph-stack"
		:title="$t(`${KEYS}.no_plan.title`)"
		:description="$t(`${KEYS}.no_plan.description`)"
	/>

	<form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
		<FormRows has-required>
			<FormFieldRow :label="$t(`${KEYS}.name`)" :error="nameError" required>
				<template #default="{ id }">
					<DmsInputText
						:id="id"
						v-model="workspaceName"
						:placeholder="$t(`${KEYS}.name_placeholder`)"
						:maxlength="NAME_MAX_LENGTH"
						class="w-full"
						autofocus
						@update:model-value="nameError = null"
					/>
				</template>
			</FormFieldRow>

			<FormFieldRow
				:label="$t(`${KEYS}.plan`)"
				:description="$t(`${KEYS}.plan_hint`)"
				:labels-control="false"
			>
				<div
					role="radiogroup"
					:aria-label="$t(`${KEYS}.plan`)"
					class="flex flex-col gap-1.5"
				>
					<button
						v-for="plan in plans"
						:key="plan._id"
						type="button"
						role="radio"
						:aria-checked="selectedPlanId === plan._id"
						class="border-default hover:border-accented flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
						:class="
							selectedPlanId === plan._id ? 'border-primary bg-primary/5' : ''
						"
						@click="selectPlan(plan)"
					>
						<span class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="text-highlighted text-sm font-medium">
								{{ plan.name }}
							</span>
							<span class="text-muted truncate text-xs">
								{{ planMeta(plan) }}
							</span>
						</span>
						<span class="text-highlighted shrink-0 text-sm tabular-nums">
							{{ planPriceLabel(plan) }}
						</span>
					</button>
				</div>
			</FormFieldRow>

			<FormFieldRow
				v-show="asksForCard"
				:label="$t(`${KEYS}.card.label`)"
				:error="cardError"
				:labels-control="false"
			>
				<template #label-extra>
					<DmsStatusPill
						size="sm"
						:tone="requirement === 'verification' ? 'info' : 'primary'"
						:label="cardBadge"
					/>
				</template>
				<p
					v-if="requirement === 'verification' && options?.freePerCard"
					class="text-muted mb-2 text-xs"
				>
					{{
						$t(
							`${KEYS}.card.why_free`,
							{ limit: options.freePerCard.limit },
							options.freePerCard.limit,
						)
					}}
				</p>
				<div
					:id="PAYMENT_ELEMENT_ID"
					class="border-default rounded-md border p-3"
				/>
				<p class="text-muted mt-1.5 flex items-center gap-1 text-xs">
					<UIcon name="i-ph-lock-simple" class="size-3.5" />
					{{
						requirement === 'verification'
							? $t(`${KEYS}.card.never_charged`)
							: $t(`${KEYS}.card.secured`)
					}}
				</p>
			</FormFieldRow>
		</FormRows>

		<p v-if="chargeSentence" class="text-muted text-sm">{{ chargeSentence }}</p>

		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:description="submitError"
		/>

		<div class="flex justify-end gap-2">
			<UButton
				v-if="props.onCancelCallback"
				color="neutral"
				variant="ghost"
				:disabled="isSubmitting"
				@click="props.onCancelCallback()"
			>
				{{ $t('common.cancel') }}
			</UButton>
			<UButton type="submit" color="primary" :loading="isSubmitting">
				{{ submitLabel }}
			</UButton>
		</div>
	</form>
</template>
