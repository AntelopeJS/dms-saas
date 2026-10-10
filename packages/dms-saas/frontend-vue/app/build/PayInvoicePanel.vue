<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type PaymentChoice = 'default_card' | 'other_card'

const props = defineProps<{
	invoice: PayableInvoice
}>()

const emit = defineEmits<{ paid: []; cancel: [] }>()

const KEY_PREFIX = 'saas.tenant_billing.pay'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { t, locale } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()
const { formatMinorUnits } = useMoneyFormat()
const { payWithDefaultCard } = usePayInvoice()
const billingStatus = useBillingStatus()
const tenantPlan = useTenantPlan()

const choice = ref<PaymentChoice>('default_card')
const isPaying = ref(false)
const failure = ref<string | null>(null)

const status = computed(() => billingStatus.data.value)
const card = computed(() => status.value?.paymentMethod ?? null)
const isTenantOwner = computed(() => !!status.value?.isTenantOwner)
const ownerName = computed(() => status.value?.workspaceOwner?.name ?? null)
const amountLabel = computed(() =>
	formatMinorUnits(props.invoice.amount, props.invoice.currency),
)
const declinedOn = computed(() =>
	formatDate(status.value?.unpaidInvoice?.failedAt, locale.value, DAY_FORMAT),
)
const canPayOnStripe = computed(() => !!props.invoice.hostedInvoiceUrl)
const effectiveChoice = computed<PaymentChoice>(() =>
	card.value ? choice.value : 'other_card',
)

const confirmLabel = computed(() =>
	effectiveChoice.value === 'default_card'
		? t(`${KEY_PREFIX}.confirm_card`, { amount: amountLabel.value })
		: t(`${KEY_PREFIX}.confirm_stripe`, { amount: amountLabel.value }),
)

function openStripePage(): void {
	const url = props.invoice.hostedInvoiceUrl
	if (url && typeof window !== 'undefined')
		window.open(url, '_blank', 'noopener')
}

async function payWithCard(): Promise<void> {
	isPaying.value = true
	failure.value = null
	try {
		const result = await payWithDefaultCard(props.invoice.invoiceId)
		toast.add({
			title: isInvoiceSettled(result)
				? t(`${KEY_PREFIX}.paid`)
				: t(`${KEY_PREFIX}.processing`),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		await Promise.all([billingStatus.refresh(), tenantPlan.refresh()])
		emit('paid')
	} catch (error) {
		failure.value = resolveApiError(error, `${KEY_PREFIX}.error`)
	} finally {
		isPaying.value = false
	}
}

function confirm(): void {
	if (effectiveChoice.value === 'other_card') {
		openStripePage()
		emit('cancel')
		return
	}
	void payWithCard()
}

onMounted(() => {
	void billingStatus.load()
})
</script>

<template>
	<div class="flex flex-col gap-4">
		<p class="text-muted text-sm">{{ $t(`${KEY_PREFIX}.description`) }}</p>

		<p v-if="status && !isTenantOwner" class="text-sm">
			{{
				ownerName
					? $t(`${KEY_PREFIX}.member_named`, { owner: ownerName })
					: $t(`${KEY_PREFIX}.member`)
			}}
		</p>

		<template v-else-if="status">
			<div role="radiogroup" class="flex flex-col gap-2">
				<DmsCard
					v-if="card"
					as="button"
					type="button"
					role="radio"
					interactive
					:selected="effectiveChoice === 'default_card'"
					:aria-checked="effectiveChoice === 'default_card'"
					class="text-left"
					@click="choice = 'default_card'"
				>
					<div class="flex items-center gap-3">
						<DmsIconWell icon="i-ph-credit-card" tone="neutral" size="sm" />
						<div class="min-w-0 grow">
							<p class="text-sm font-medium">{{ formatCardLabel(card) }}</p>
							<p v-if="declinedOn" class="text-warning text-xs">
								{{ $t(`${KEY_PREFIX}.declined_on`, { date: declinedOn }) }}
							</p>
						</div>
					</div>
				</DmsCard>
				<DmsCard
					v-if="canPayOnStripe"
					as="button"
					type="button"
					role="radio"
					interactive
					:selected="effectiveChoice === 'other_card'"
					:aria-checked="effectiveChoice === 'other_card'"
					class="text-left"
					@click="choice = 'other_card'"
				>
					<div class="flex items-center gap-3">
						<DmsIconWell icon="i-ph-plus" tone="neutral" size="sm" />
						<div class="min-w-0 grow">
							<p class="text-sm font-medium">
								{{ $t(`${KEY_PREFIX}.other_card`) }}
							</p>
							<p class="text-muted text-xs">
								{{ $t(`${KEY_PREFIX}.other_card_hint`) }}
							</p>
						</div>
					</div>
				</DmsCard>
			</div>

			<p v-if="!card && !canPayOnStripe" class="text-muted text-sm">
				{{ $t(`${KEY_PREFIX}.no_method`) }}
			</p>

			<UAlert
				v-if="failure"
				color="error"
				variant="subtle"
				icon="i-ph-warning-circle"
				:title="failure"
				:description="$t(`${KEY_PREFIX}.error_hint`)"
			/>
		</template>

		<UAlert
			v-else-if="billingStatus.error.value"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:title="$t(`${KEY_PREFIX}.status_error`)"
			:actions="[
				{
					label: $t('saas.common.retry'),
					color: 'error',
					variant: 'soft',
					onClick: () => billingStatus.refresh(),
				},
			]"
		/>

		<USkeleton v-else class="h-24 w-full" />

		<div class="flex justify-end gap-2">
			<UButton color="neutral" variant="ghost" @click="emit('cancel')">
				{{ $t(`${KEY_PREFIX}.not_now`) }}
			</UButton>
			<UButton
				v-if="isTenantOwner && (card || canPayOnStripe)"
				color="primary"
				:icon="
					effectiveChoice === 'other_card'
						? 'i-ph-arrow-square-out'
						: 'i-ph-lock-simple'
				"
				:loading="isPaying"
				@click="confirm"
			>
				{{ confirmLabel }}
			</UButton>
		</div>
	</div>
</template>
