<script setup lang="ts">
import { computed } from 'vue'

/** `GET /api/saas/billing/refund-eligibility`. */
interface RefundEligibility {
	eligible: boolean
	reason: string | null
	windowDays: number
	mode: string | null
	refundAmount: number | null
	currency: string | null
	paymentsCount: number
	firstPaymentAt: string | null
	windowEndsAt: string | null
	refundedAt: string | null
}

type GuaranteeState = 'open' | 'ended' | 'refunded' | 'not_started' | 'blocked'

/** `GET /api/saas/billing/access`, as far as the card reads it. */
interface WorkspaceAccess {
	blocked: boolean
	isTenantOwner: boolean
}

/** What the card shows, read in one go: the eligibility is the owner's. */
interface RefundGuarantee {
	isOwner: boolean
	isBlocked: boolean
	eligibility: RefundEligibility | null
	/** Days the data is kept once the subscription stops. */
	retentionDays: number
	/** The owner's eligibility could not be read. */
	hasFailed: boolean
}

const ACCESS_ENDPOINT = '/api/saas/billing/access'
const CURRENT_WORKSPACE_ENDPOINT = '/api/saas/workspaces/current'
const ELIGIBILITY_ENDPOINT = '/api/saas/billing/refund-eligibility'
const REFUND_ENDPOINT = '/api/saas/billing/refund-self'
const KEY_PREFIX = 'saas.tenant_billing.money_back'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
// No guarantee to show: switched off by the platform, or nothing paid on Stripe.
const HIDDEN_REASONS = new Set(['not_enabled', 'no_subscription'])
const REFUNDED_REASON = 'already_processed'
const STATE_BY_REASON: Record<string, GuaranteeState> = {
	window_expired: 'ended',
	[REFUNDED_REASON]: 'refunded',
	no_invoice: 'not_started',
}

const { $authFetch } = useAuthFetch()
const toast = useToast()
const { t, locale } = useI18n()
const { confirm } = useConfirm()
const { resolveApiError } = useApiErrorMessage()
const { formatMinorUnits } = useMoneyFormat()
const billingStatus = useBillingStatus()
const tenantPlan = useTenantPlan()

/**
 * The eligibility read is owner-only; it stays open while the access gate
 * blocks the workspace, so a refunded guarantee is still told apart. A failed
 * access read fails open, as the backend gate still denies every surface.
 */
const guarantee = useApiData<RefundGuarantee>(
	'saas-refund-guarantee',
	async ({ $authFetch, signal }) => {
		const access = await $authFetch<WorkspaceAccess>(ACCESS_ENDPOINT, {
			signal,
		}).catch(() => null)
		const isOwner = !!access?.isTenantOwner
		const read: RefundGuarantee = {
			isOwner,
			isBlocked: !!access?.blocked,
			eligibility: null,
			retentionDays: 0,
			hasFailed: false,
		}
		if (!isOwner) return read
		try {
			const [eligibility, workspace] = await Promise.all([
				$authFetch<RefundEligibility>(ELIGIBILITY_ENDPOINT, { signal }),
				$authFetch<CurrentWorkspace>(CURRENT_WORKSPACE_ENDPOINT, { signal }),
			])
			return { ...read, eligibility, retentionDays: workspace.retentionDays }
		} catch {
			return { ...read, hasFailed: true }
		}
	},
)
const eligibility = computed(() => guarantee.data.value?.eligibility ?? null)
const isOwner = computed(() => !!guarantee.data.value?.isOwner)
const isBlocked = computed(() => !!guarantee.data.value?.isBlocked)
const isLoading = computed(() => guarantee.pending.value)
const loadFailed = computed(() => !!guarantee.data.value?.hasFailed)

// A refund blocks the workspace (it cancels the subscription): a refunded
// guarantee says so before the access gate is mentioned.
const state = computed<GuaranteeState | null>(() => {
	const current = eligibility.value
	if (current?.reason === REFUNDED_REASON) return 'refunded'
	if (isBlocked.value) return 'blocked'
	if (!current) return null
	if (current.eligible) return 'open'
	if (HIDDEN_REASONS.has(current.reason ?? '')) return null
	return STATE_BY_REASON[current.reason ?? ''] ?? null
})

function day(value: string | null | undefined): string {
	return formatDate(value, locale.value, DAY_FORMAT) ?? ''
}

const amountLabel = computed(() =>
	formatMinorUnits(
		eligibility.value?.refundAmount,
		eligibility.value?.currency,
	),
)
const planName = computed(() => tenantPlan.data.value?.current?.name ?? '')
const daysLeft = computed(() =>
	eligibility.value?.windowEndsAt
		? countDaysUntil(eligibility.value.windowEndsAt, new Date())
		: 0,
)
const dayOfWindow = computed(() => {
	const window = eligibility.value
	if (!window?.firstPaymentAt) return 0
	const elapsed = countDaysBetween(window.firstPaymentAt, new Date()) + 1
	return Math.min(Math.max(elapsed, 1), window.windowDays)
})

const paidOn = computed(() => day(eligibility.value?.firstPaymentAt))
// Every payment made within the window is refunded, not only the first.
const paymentsLabel = computed(() => {
	const count = eligibility.value?.paymentsCount ?? 1
	return t(`${KEY_PREFIX}.payments`, { count, paidOn: paidOn.value }, count)
})

const params = computed(() => ({
	amount: amountLabel.value,
	payments: paymentsLabel.value,
	plan: planName.value,
	date: day(eligibility.value?.windowEndsAt),
	paidOn: paidOn.value,
	refundedOn: day(eligibility.value?.refundedAt),
	window: eligibility.value?.windowDays ?? 0,
	days: daysLeft.value,
	day: dayOfWindow.value,
	retention: guarantee.data.value?.retentionDays ?? 0,
}))

const pill = computed(() => {
	if (state.value === 'open') {
		return {
			tone: 'success',
			label: t(`${KEY_PREFIX}.days_left`, params.value, daysLeft.value),
		}
	}
	if (state.value === 'ended') {
		return { tone: 'neutral', label: t(`${KEY_PREFIX}.ended_on`, params.value) }
	}
	if (state.value === 'refunded') {
		return { tone: 'info', label: t(`${KEY_PREFIX}.refunded_pill`) }
	}
	return null
})

async function submitRefund(): Promise<void> {
	await $authFetch(REFUND_ENDPOINT, { method: 'POST' })
	toast.add({
		title: t(`${KEY_PREFIX}.success`),
		color: 'success',
		icon: 'i-ph-check-circle',
	})
	// The dialog closes once the page shows the refund.
	await refreshPageBlocks()
}

async function requestRefund(): Promise<void> {
	await billingStatus
	const card = billingStatus.data.value?.paymentMethod
	const members = tenantPlan.data.value?.seats.members ?? 0
	await confirm({
		title: t(`${KEY_PREFIX}.confirm_title`, params.value),
		description: t(`${KEY_PREFIX}.confirm_description`),
		color: 'error',
		icon: 'i-ph-arrow-counter-clockwise',
		initialFocus: 'cancel',
		confirmLabel: t(`${KEY_PREFIX}.confirm_action`),
		cancelLabel: t(`${KEY_PREFIX}.keep`, params.value),
		impact: [
			{
				icon: 'i-ph-credit-card',
				label: card
					? t(`${KEY_PREFIX}.impact_refunded_to`, {
							card: formatCardLabel(card),
						})
					: t(`${KEY_PREFIX}.impact_refunded`),
				count: amountLabel.value,
			},
			{
				icon: 'i-ph-calendar-x',
				label: t(`${KEY_PREFIX}.impact_ends`),
				count: t(`${KEY_PREFIX}.impact_now`),
			},
			{
				icon: 'i-ph-users-three',
				label: t(`${KEY_PREFIX}.impact_members`),
				count: members,
			},
			{
				icon: 'i-ph-database',
				label: t(`${KEY_PREFIX}.impact_data`),
				count: t(`${KEY_PREFIX}.impact_data_kept`, params.value),
			},
		],
		onConfirm: async () => {
			try {
				await submitRefund()
			} catch (error) {
				throw new Error(resolveApiError(error, `${KEY_PREFIX}.error`))
			}
		},
	})
}
</script>

<template>
	<DmsCard
		v-if="isOwner && (isLoading || loadFailed || state)"
		class="grow"
		:title="$t(`${KEY_PREFIX}.title`)"
	>
		<template v-if="pill" #actions>
			<DmsStatusPill :tone="pill.tone" :label="pill.label" />
		</template>

		<div v-if="isLoading" class="flex flex-col gap-3">
			<USkeleton class="h-4 w-1/3" />
			<USkeleton class="h-2 w-full" />
			<USkeleton class="h-4 w-full" />
		</div>

		<DmsSaasLoadFailure
			v-else-if="loadFailed"
			:title="$t(`${KEY_PREFIX}.load_failed`)"
			@retry="guarantee.refresh()"
		/>

		<div v-else-if="state === 'open'" class="flex flex-col gap-4">
			<DmsMeter
				:label="$t(`${KEY_PREFIX}.until`, params)"
				:value="dayOfWindow"
				:max="eligibility?.windowDays ?? 0"
				format="none"
				:hint="$t(`${KEY_PREFIX}.day_of`, params)"
				:warn-at="75"
				size="sm"
			/>
			<p class="text-sm">{{ $t(`${KEY_PREFIX}.description`, params) }}</p>
			<div class="flex flex-wrap items-center gap-3">
				<p class="text-muted grow text-xs">
					<UIcon name="i-ph-info" class="me-1 align-middle" />
					{{ $t(`${KEY_PREFIX}.once`) }}
				</p>
				<UButton
					color="error"
					variant="soft"
					icon="i-ph-arrow-counter-clockwise"
					@click="requestRefund"
				>
					{{ $t(`${KEY_PREFIX}.request`) }}
				</UButton>
			</div>
		</div>

		<p v-else-if="state === 'ended'" class="text-muted text-sm">
			{{ $t(`${KEY_PREFIX}.ended_description`, params) }}
		</p>

		<p v-else-if="state === 'refunded'" class="text-muted text-sm">
			{{
				eligibility?.refundedAt
					? $t(`${KEY_PREFIX}.refunded_description_on`, params)
					: $t(`${KEY_PREFIX}.refunded_description`)
			}}
		</p>

		<p v-else-if="state === 'not_started'" class="text-muted text-sm">
			{{ $t(`${KEY_PREFIX}.not_started_description`, params) }}
		</p>

		<p v-else-if="state === 'blocked'" class="text-muted text-sm">
			{{ $t(`${KEY_PREFIX}.blocked_description`) }}
		</p>
	</DmsCard>
</template>
