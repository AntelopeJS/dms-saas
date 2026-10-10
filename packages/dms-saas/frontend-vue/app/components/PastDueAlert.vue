<script setup lang="ts">
import { computed, onMounted } from 'vue'
import PayInvoiceDialog from '../build/PayInvoiceDialog.vue'

interface TimelineStep {
	key: string
	date: string
	text: string
	tone: 'error' | 'primary' | 'neutral' | 'warning'
}

const SUSPENDED_STATUS = 'suspended'
const UNPAID_STATUSES = new Set(['past_due', SUSPENDED_STATUS])
const KEY_PREFIX = 'saas.tenant_billing.past_due'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { data, error, load, refresh } = useBillingStatus()
const { formatMinorUnits } = useMoneyFormat()
const { open: openPayment } = usePayInvoice()
const { t, locale } = useI18n()

const invoice = computed(() => data.value?.unpaidInvoice ?? null)
const isSuspended = computed(() => data.value?.status === SUSPENDED_STATUS)
const isTenantOwner = computed(() => !!data.value?.isTenantOwner)
const ownerName = computed(() => data.value?.workspaceOwner?.name ?? null)
/** Members get no invoice details: they are told who settles it. */
const isMemberNotice = computed(
	() => !isTenantOwner.value && UNPAID_STATUSES.has(data.value?.status ?? ''),
)

function day(value: string | null | undefined): string | null {
	return formatDate(value, locale.value, DAY_FORMAT)
}

const amountLabel = computed(() =>
	formatMinorUnits(invoice.value?.amount, invoice.value?.currency),
)
const subject = computed(() => ({
	invoice: invoice.value?.number ?? amountLabel.value,
	amount: amountLabel.value,
}))
const card = computed(() => data.value?.paymentMethod ?? null)

const title = computed(() =>
	isSuspended.value
		? t(`${KEY_PREFIX}.suspended_title`)
		: t(`${KEY_PREFIX}.title`),
)

const summary = computed(() => {
	if (isSuspended.value)
		return t(`${KEY_PREFIX}.suspended_summary`, subject.value)
	const failedOn = day(invoice.value?.failedAt)
	const sentences = [
		failedOn
			? t(`${KEY_PREFIX}.summary_with_date`, {
					...subject.value,
					date: failedOn,
				})
			: t(`${KEY_PREFIX}.summary`, subject.value),
		day(invoice.value?.nextRetryAt) &&
			t(`${KEY_PREFIX}.next_retry`, { date: day(invoice.value?.nextRetryAt) }),
		day(invoice.value?.suspendAt) &&
			t(`${KEY_PREFIX}.suspend_warning`, {
				date: day(invoice.value?.suspendAt),
			}),
	]
	return sentences.filter(Boolean).join(' ')
})

/**
 * The dunning timeline as far as it is known: each step is dropped when the
 * date behind it is missing (no retry left, auto-suspension off).
 */
const timeline = computed<TimelineStep[]>(() => {
	const unpaid = invoice.value
	if (!unpaid || isSuspended.value) return []
	const steps: (TimelineStep | null)[] = [
		unpaid.failedAt
			? {
					key: 'declined',
					date: day(unpaid.failedAt) ?? '',
					text: card.value
						? t(`${KEY_PREFIX}.timeline.declined_card`, {
								card: formatCardLabel(card.value),
							})
						: t(`${KEY_PREFIX}.timeline.declined`),
					tone: 'error',
				}
			: null,
		{
			key: 'today',
			date: t(`${KEY_PREFIX}.timeline.today`),
			text: t(`${KEY_PREFIX}.timeline.pay_now`),
			tone: 'primary',
		},
		unpaid.nextRetryAt
			? {
					key: 'retry',
					date: day(unpaid.nextRetryAt) ?? '',
					text: t(`${KEY_PREFIX}.timeline.retry`),
					tone: 'neutral',
				}
			: null,
		unpaid.suspendAt
			? {
					key: 'suspend',
					date: day(unpaid.suspendAt) ?? '',
					text: t(`${KEY_PREFIX}.timeline.suspend`),
					tone: 'warning',
				}
			: null,
	]
	return steps.filter((step): step is TimelineStep => step !== null)
})

const DOT_CLASSES: Record<TimelineStep['tone'], string> = {
	error: 'bg-error',
	primary: 'bg-primary',
	neutral: 'bg-(--ui-border-accented)',
	warning: 'bg-warning',
}

function payInvoice(): void {
	const unpaid = invoice.value
	if (!unpaid) return
	openPayment({
		invoiceId: unpaid.invoiceId,
		number: unpaid.number,
		amount: unpaid.amount,
		currency: unpaid.currency,
		hostedInvoiceUrl: unpaid.hostedInvoiceUrl,
	})
}

onMounted(load)
</script>

<template>
	<DmsSaasLoadFailure
		v-if="error && !data"
		:title="$t(`${KEY_PREFIX}.load_failed`)"
		@retry="refresh"
	/>

	<DmsBanner
		v-else-if="invoice && isTenantOwner"
		tone="error"
		icon="i-ph-warning-circle"
		:title="title"
		data-saas-past-due-alert
	>
		<template #description>
			<div class="flex flex-col gap-3">
				<p>{{ summary }}</p>
				<ol
					v-if="timeline.length"
					class="grid gap-2 sm:grid-cols-4"
					:aria-label="$t(`${KEY_PREFIX}.timeline.label`)"
				>
					<li
						v-for="step in timeline"
						:key="step.key"
						class="flex items-start gap-2"
					>
						<span
							class="mt-1.5 size-2 shrink-0 rounded-full"
							:class="DOT_CLASSES[step.tone]"
						/>
						<span class="flex flex-col">
							<span class="text-highlighted text-xs font-semibold">
								{{ step.date }}
							</span>
							<span class="text-xs">{{ step.text }}</span>
						</span>
					</li>
				</ol>
			</div>
		</template>
		<template #actions>
			<DmsSaasCustomerPortalButton
				label-key="saas.tenant_billing.past_due.update_card"
				icon="i-ph-credit-card"
				size="sm"
			/>
			<UButton
				color="error"
				size="sm"
				icon="i-ph-lock-simple"
				@click="payInvoice"
			>
				{{ $t(`${KEY_PREFIX}.pay`) }}
			</UButton>
		</template>
	</DmsBanner>

	<DmsBanner
		v-else-if="isMemberNotice"
		tone="warning"
		icon="i-ph-warning-circle"
		:title="title"
		:description="
			ownerName
				? $t(`${KEY_PREFIX}.member_named`, { owner: ownerName })
				: $t(`${KEY_PREFIX}.member`)
		"
	/>

	<PayInvoiceDialog v-if="isTenantOwner" />
</template>
