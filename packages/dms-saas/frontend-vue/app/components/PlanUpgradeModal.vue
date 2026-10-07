<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
	plan: OfferedPlanView | null
	workspaceName?: string | null
}>()

const emit = defineEmits<{ changed: [] }>()

const open = defineModel<boolean>('open', { default: false })

const KEY_PREFIX = 'saas.tenant_billing.plan_change.checkout'
const PREVIEW_DEBOUNCE_MS = 400
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const toast = useToast()
const { t, locale } = useI18n()
const { resolveApiError } = useApiErrorMessage()
const identity = useBillingIdentity()
const { changePlan, previewChange } = useTenantPlan()
const { offerFor: offerPendingCheckout } = usePendingCheckout()
const { formatMajorUnits, formatMinorUnits } = useMoneyFormat()
const planIntervalLabel = usePlanIntervalLabel('saas.workspace.plan.interval')

const draft = ref<BillingIdentityDraft>(emptyBillingIdentityDraft())
const hasTriedSubmit = ref(false)
// Flagged once a submit was attempted, then re-checked as the user types so
// a corrected field clears its error right away.
const invalidFields = computed<BillingIdentityField[]>(() =>
	hasTriedSubmit.value ? findMissingBillingFields(draft.value) : [],
)
const isLoading = ref(false)
const loadFailed = ref(false)
const isSubmitting = ref(false)
const preview = ref<PlanChangePreview | null>(null)
const isPricing = ref(false)
let pricingTimer: ReturnType<typeof setTimeout> | null = null

const currency = computed(() => preview.value?.currency ?? props.plan?.currency)
const charge = computed(() => preview.value?.charge ?? null)
const tax = computed(() => charge.value?.taxes[0] ?? null)
const isTrial = computed(() => !!preview.value?.isTrial)
const firstChargeOn = computed(() =>
	formatDate(preview.value?.trialEndsAt, locale.value, DAY_FORMAT),
)
const planLabel = computed(() =>
	props.plan
		? t(`${KEY_PREFIX}.plan_line`, {
				plan: props.plan.name,
				interval: planIntervalLabel(props.plan.interval),
			})
		: '',
)
const planAmount = computed(() => {
	if (charge.value)
		return formatMinorUnits(charge.value.subtotalMinorUnits, currency.value)
	return props.plan
		? formatMajorUnits(props.plan.price, props.plan.currency)
		: ''
})
const dueToday = computed(() => {
	if (isTrial.value) return formatMinorUnits(0, currency.value)
	return charge.value
		? formatMinorUnits(charge.value.amountDueMinorUnits, currency.value)
		: null
})

async function loadIdentity(): Promise<void> {
	isLoading.value = true
	loadFailed.value = false
	hasTriedSubmit.value = false
	try {
		draft.value = toBillingIdentityDraft(await identity.load())
	} catch {
		loadFailed.value = true
	} finally {
		isLoading.value = false
	}
}

async function price(): Promise<void> {
	const plan = props.plan
	if (!plan) return
	isPricing.value = true
	try {
		preview.value = await previewChange(plan._id, draft.value.country || null)
	} catch {
		preview.value = null
	} finally {
		isPricing.value = false
	}
}

function schedulePricing(): void {
	if (pricingTimer) clearTimeout(pricingTimer)
	pricingTimer = setTimeout(() => void price(), PREVIEW_DEBOUNCE_MS)
}

watch(open, async (isOpen) => {
	if (!isOpen) return
	preview.value = null
	await loadIdentity()
	void price()
})

watch(
	() => draft.value.country,
	() => {
		if (open.value && !isLoading.value) schedulePricing()
	},
)

function notifyError(title: string): void {
	toast.add({ title, color: 'error', icon: 'i-ph-warning-circle' })
}

/**
 * The identity is saved first: the plan change checks the plan's audience
 * against the stored customer type, and Stripe Checkout bills the customer
 * this identity describes. The card itself is collected by Stripe.
 */
async function confirm(): Promise<void> {
	const plan = props.plan
	if (!plan) return
	hasTriedSubmit.value = true
	if (invalidFields.value.length > 0) {
		notifyError(t('saas.tenant_billing.billing_info.incomplete_toast'))
		return
	}
	isSubmitting.value = true
	try {
		await identity.save(draft.value)
		const result = await changePlan(plan._id)
		if (result.checkoutUrl && typeof window !== 'undefined') {
			window.location.href = result.checkoutUrl
			return
		}
		toast.add({
			title: t('saas.workspace.plan.change_applied'),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		open.value = false
		emit('changed')
	} catch (error) {
		if (await offerPendingCheckout(error, plan._id)) {
			open.value = false
			return
		}
		notifyError(resolveApiError(error, 'saas.workspace.plan.change_error'))
	} finally {
		isSubmitting.value = false
	}
}
</script>

<template>
	<UModal
		v-model:open="open"
		:title="
			$t(`${KEY_PREFIX}.title`, {
				workspace: workspaceName ?? '',
				plan: plan?.name ?? '',
			})
		"
		:description="$t(`${KEY_PREFIX}.description`)"
		:ui="{ content: 'max-w-2xl' }"
	>
		<template #body>
			<div v-if="isLoading" class="flex flex-col gap-3">
				<USkeleton class="h-20 w-full" />
				<USkeleton class="h-10 w-full" />
				<USkeleton class="h-10 w-full" />
			</div>

			<DmsSaasLoadFailure v-else-if="loadFailed" @retry="loadIdentity" />

			<form
				v-else-if="plan"
				id="saas-plan-upgrade-form"
				class="flex flex-col gap-6"
				novalidate
				@submit.prevent="confirm"
			>
				<DmsSection
					:title="$t('saas.tenant_billing.billing_info.title')"
					:card="false"
				>
					<DmsSaasBillingIdentityFields
						v-model="draft"
						:invalid-fields="invalidFields"
					/>
				</DmsSection>

				<DmsCard>
					<div class="flex flex-col gap-2 text-sm">
						<div class="flex justify-between gap-4">
							<span class="flex items-center gap-2">
								{{ planLabel }}
								<UBadge v-if="isTrial" color="info" variant="subtle" size="sm">
									{{
										$t(`${KEY_PREFIX}.trial_badge`, { days: plan.trialDays })
									}}
								</UBadge>
							</span>
							<span class="tabular-nums">{{ planAmount }}</span>
						</div>
						<div v-if="tax" class="flex justify-between gap-4">
							<span>
								{{
									$t(`${KEY_PREFIX}.tax`, {
										rate:
											tax.ratePercentage === null
												? ''
												: `${tax.ratePercentage}%`,
										country: tax.country ?? '',
									})
								}}
							</span>
							<span class="tabular-nums">
								{{ formatMinorUnits(tax.amountMinorUnits, currency) }}
							</span>
						</div>
						<div
							class="border-default flex justify-between gap-4 border-t pt-2 font-semibold"
						>
							<span>{{ $t(`${KEY_PREFIX}.due_today`) }}</span>
							<USkeleton v-if="isPricing" class="h-5 w-16" />
							<span v-else class="text-primary tabular-nums">
								{{
									dueToday ??
									$t(`${KEY_PREFIX}.excl_tax`, { amount: planAmount })
								}}
							</span>
						</div>
						<p v-if="isTrial && charge" class="text-muted">
							{{
								$t(`${KEY_PREFIX}.first_charge`, {
									amount: formatMinorUnits(
										charge.amountDueMinorUnits,
										currency,
									),
									date: firstChargeOn ?? '',
									interval: planIntervalLabel(plan.interval),
								})
							}}
						</p>
						<p v-else-if="!charge && !isPricing" class="text-muted">
							{{ $t(`${KEY_PREFIX}.tax_on_stripe`) }}
						</p>
					</div>
				</DmsCard>

				<p class="text-muted flex items-center gap-2 text-sm">
					<UIcon name="i-ph-lock-simple" />
					{{ $t(`${KEY_PREFIX}.card_note`) }}
				</p>
			</form>
		</template>

		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton color="neutral" variant="subtle" @click="open = false">
					{{ $t('common.cancel') }}
				</UButton>
				<UButton
					type="submit"
					form="saas-plan-upgrade-form"
					color="primary"
					icon="i-ph-lock-simple"
					:loading="isSubmitting"
					:disabled="isLoading || loadFailed"
				>
					{{ $t(`${KEY_PREFIX}.confirm`) }}
				</UButton>
			</div>
		</template>
	</UModal>
</template>
