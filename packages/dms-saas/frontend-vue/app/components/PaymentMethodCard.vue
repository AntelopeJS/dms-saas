<script setup lang="ts">
import { computed, onMounted } from 'vue'

const UNPAID_STATUSES = new Set(['past_due', 'suspended'])
const KEY_PREFIX = 'saas.tenant_billing.payment_method'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}

const { data, error, load, refresh } = useBillingStatus()
const { data: plan, load: loadPlan } = useTenantPlan()
const { open: openPlanComparison } = usePlanComparison()
const { open: openPayment } = usePayInvoice()
const { locale } = useI18n()

const card = computed(() => data.value?.paymentMethod ?? null)
const unpaidInvoice = computed(() => data.value?.unpaidInvoice ?? null)
const needsUpdate = computed(() =>
	UNPAID_STATUSES.has(data.value?.status ?? ''),
)
const isTenantOwner = computed(() => !!data.value?.isTenantOwner)
const ownerName = computed(() => data.value?.workspaceOwner?.name ?? null)
const hasStripeCustomer = computed(() => !!data.value?.hasStripeCustomer)
const complimentaryAccess = computed(() =>
	resolveComplimentaryAccess(plan.value),
)
const declinedOn = computed(() =>
	formatDate(unpaidInvoice.value?.failedAt, locale.value, DAY_FORMAT),
)
const cardDetail = computed(() => {
	if (!card.value) return ''
	const holder = card.value.holderName
	const expiry = formatCardExpiry(card.value)
	return holder ? `${expiry} · ${holder}` : expiry
})

function payWithAnotherCard(): void {
	const unpaid = unpaidInvoice.value
	if (!unpaid) return
	openPayment({
		invoiceId: unpaid.invoiceId,
		number: unpaid.number,
		amount: unpaid.amount,
		currency: unpaid.currency,
		hostedInvoiceUrl: unpaid.hostedInvoiceUrl,
	})
}

onMounted(() => {
	void loadPlan()
	return load()
})
</script>

<template>
	<DmsCard :title="$t(`${KEY_PREFIX}.title`)">
		<template v-if="data && isTenantOwner && card" #actions>
			<DmsStatusPill
				:tone="needsUpdate ? 'warning' : 'success'"
				:label="
					needsUpdate
						? $t(`${KEY_PREFIX}.needs_update`)
						: $t(`${KEY_PREFIX}.default`)
				"
			/>
		</template>

		<div v-if="!data && !error" class="flex flex-col gap-3">
			<USkeleton class="h-14 w-full" />
			<USkeleton class="h-4 w-2/3" />
		</div>

		<DmsSaasLoadFailure
			v-else-if="error && !data"
			:title="$t(`${KEY_PREFIX}.load_failed`)"
			@retry="refresh"
		/>

		<p v-else-if="!isTenantOwner" class="text-muted text-sm">
			{{
				ownerName
					? $t(`${KEY_PREFIX}.owner_only_named`, { owner: ownerName })
					: $t(`${KEY_PREFIX}.owner_only`)
			}}
		</p>

		<DmsEmptyState
			v-else-if="complimentaryAccess"
			size="sm"
			icon="i-ph-gift"
			:title="$t(`${KEY_PREFIX}.complimentary_title`)"
			:description="$t(`${KEY_PREFIX}.complimentary_description`)"
		/>

		<div v-else-if="card" class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-3">
				<DmsIconWell
					icon="i-ph-credit-card"
					:tone="needsUpdate ? 'warning' : 'neutral'"
					size="md"
				/>
				<div class="min-w-0 grow">
					<p class="font-medium">{{ formatCardLabel(card) }}</p>
					<p class="text-muted text-sm">
						{{ $t(`${KEY_PREFIX}.expires`, { detail: cardDetail }) }}
					</p>
				</div>
				<span v-if="needsUpdate && declinedOn" class="text-warning text-sm">
					{{ $t(`${KEY_PREFIX}.declined_on`, { date: declinedOn }) }}
				</span>
			</div>
			<div v-if="needsUpdate" class="flex flex-col gap-2">
				<p class="text-sm">{{ $t(`${KEY_PREFIX}.update_note`) }}</p>
				<UButton
					v-if="unpaidInvoice?.hostedInvoiceUrl"
					class="self-start"
					size="sm"
					color="neutral"
					variant="link"
					icon="i-ph-plus"
					@click="payWithAnotherCard"
				>
					{{ $t(`${KEY_PREFIX}.pay_another_card`) }}
				</UButton>
			</div>
		</div>

		<DmsEmptyState
			v-else
			size="sm"
			icon="i-ph-credit-card"
			:title="$t(`${KEY_PREFIX}.none_title`)"
			:description="
				hasStripeCustomer
					? $t(`${KEY_PREFIX}.none_with_portal`)
					: $t(`${KEY_PREFIX}.none`)
			"
		>
			<template v-if="!hasStripeCustomer" #actions>
				<UButton
					size="sm"
					color="primary"
					variant="subtle"
					icon="i-ph-stack"
					@click="openPlanComparison"
				>
					{{ $t(`${KEY_PREFIX}.choose_plan`) }}
				</UButton>
			</template>
		</DmsEmptyState>

		<template v-if="data && isTenantOwner && hasStripeCustomer" #footer>
			<div class="flex w-full flex-wrap items-center gap-3">
				<p class="text-muted grow text-xs">
					<UIcon name="i-ph-lock-simple" class="me-1 align-middle" />
					{{ $t(`${KEY_PREFIX}.stripe_note`) }}
				</p>
				<DmsSaasCustomerPortalButton
					:label-key="
						needsUpdate
							? 'saas.tenant_billing.past_due.update_card'
							: 'saas.tenant_billing.portal.open'
					"
					size="sm"
				/>
			</div>
		</template>
	</DmsCard>
</template>
