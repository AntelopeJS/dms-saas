<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import PayInvoiceDialog from '../build/PayInvoiceDialog.vue'
import { useWorkspaceName } from '../build/useWorkspaceName'

// Rendered as the content of the DMS layout strip registered server-side
// (see registerPastDueBanners), which already decided it shows to this
// audience and draws the chrome, icon and role around it.
const props = withDefaults(defineProps<{ audience?: 'owner' | 'member' }>(), {
	audience: 'owner',
})

const KEY_PREFIX = 'saas.tenant_billing.past_due.strip'
const BILLING_PATH = '/settings/workspace/billing'
const LAYOUT_BANNER_SELECTOR = '[data-dms-layout-banner]'
const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'long',
}

const { data, load } = useBillingStatus()
const workspaceName = useWorkspaceName()
const { formatMinorUnits } = useMoneyFormat()
const { open: openPayment } = usePayInvoice()
const { t, locale } = useI18n()
const route = useDmsRoute()
const root = ref<HTMLElement | null>(null)

const isOwnerStrip = computed(() => props.audience === 'owner')
const invoice = computed(() => data.value?.unpaidInvoice ?? null)
const owner = computed(() => data.value?.workspaceOwner ?? null)
/** The billing page shows the detailed alert in its place. */
const isOnBillingPage = computed(() => route.path.startsWith(BILLING_PATH))

const deadline = computed(() =>
	formatDate(invoice.value?.suspendAt, locale.value, DEADLINE_FORMAT),
)

const ownerMessage = computed(() => {
	if (!invoice.value) return t(`${KEY_PREFIX}.owner_generic`)
	const amount = formatMinorUnits(invoice.value.amount, invoice.value.currency)
	const subject = {
		invoice: invoice.value.number ?? amount,
		amount,
		workspace: workspaceName.value,
	}
	return deadline.value
		? t(`${KEY_PREFIX}.owner_deadline`, { ...subject, date: deadline.value })
		: t(`${KEY_PREFIX}.owner`, subject)
})

const memberMessage = computed(() =>
	owner.value
		? t(`${KEY_PREFIX}.member_named`, {
				workspace: workspaceName.value,
				owner: owner.value.name,
			})
		: t(`${KEY_PREFIX}.member`, { workspace: workspaceName.value }),
)

const ownerMailto = computed(() =>
	owner.value ? `mailto:${encodeURIComponent(owner.value.email)}` : null,
)

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

// The layout strip is drawn by the DMS around this content; on the billing
// page the whole strip steps aside for the detailed alert instead of leaving
// an empty band.
watchEffect(() => {
	const row = root.value?.closest<HTMLElement>(LAYOUT_BANNER_SELECTOR)
	if (row) row.hidden = isOnBillingPage.value
})

onMounted(load)
</script>

<template>
	<div
		ref="root"
		data-saas-past-due-banner
		class="flex flex-wrap items-center gap-x-3 gap-y-2"
	>
		<p class="min-w-0 grow">
			{{ isOwnerStrip ? ownerMessage : memberMessage }}
		</p>
		<template v-if="isOwnerStrip">
			<DmsSaasCustomerPortalButton
				label-key="saas.tenant_billing.past_due.update_card"
				icon="i-ph-credit-card"
				variant="ghost"
				size="xs"
			/>
			<UButton
				v-if="invoice"
				size="xs"
				color="error"
				icon="i-ph-lock-simple"
				@click="payInvoice"
			>
				{{ $t('saas.tenant_billing.past_due.pay') }}
			</UButton>
			<UButton v-else size="xs" color="error" :to="BILLING_PATH">
				{{ $t('saas.tenant_billing.past_due.pay') }}
			</UButton>
			<PayInvoiceDialog v-if="!isOnBillingPage" />
		</template>
		<UButton
			v-else-if="ownerMailto"
			size="xs"
			color="neutral"
			variant="outline"
			icon="i-ph-envelope-simple"
			:href="ownerMailto"
		>
			{{ $t(`${KEY_PREFIX}.email_owner`, { owner: owner?.name ?? '' }) }}
		</UButton>
	</div>
</template>
