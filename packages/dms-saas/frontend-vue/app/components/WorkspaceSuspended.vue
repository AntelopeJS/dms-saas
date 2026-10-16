<script setup lang="ts">
/**
 * "Workspace access restricted": why the workspace is closed and since when,
 * how the workspace owner reopens it, whom a member should ask, and the
 * caller's other workspaces. Reachable while the access gate blocks.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
	ACCESS_REASON_VIEWS,
	workspaceInitials,
	type WorkspaceAccessDetails,
} from '../build/public/access'
import AccessTimeline from '../build/public/AccessTimeline.vue'
import OtherWorkspaces from '../build/public/OtherWorkspaces.vue'
import {
	BILLING_CHOOSE_PLAN_PATH,
	billingUpgradePath,
	BILLING_PATH,
	HOME_PATH,
	LOGIN_PATH,
} from '../build/public/routes'

const ACCESS_ENDPOINT = '/api/saas/workspace-access'
const PORTAL_ENDPOINT = '/api/saas/billing/portal-session'

/** Reasons the owner settles by choosing a plan, on the comparison itself. */
const PLAN_CHOICE_REASONS = new Set([
	'cancelled',
	'deleted',
	'complimentary_expired',
])
const DELETED_REASON = 'deleted'
const PENDING_PAYMENT_REASON = 'pending_payment'

interface PortalSession {
	url: string
}

const { t, locale } = useI18n()
const toast = useToast()
const { $authFetch } = useAuthFetch()
const { user, clear: clearSession } = useDmsUserSession()
const { resolveApiError } = useApiErrorMessage()
const { formatMinorUnits } = useMoneyFormat()
const { statusView } = useSaasStatus()

const accessRead = useApiData<WorkspaceAccessDetails>(ACCESS_ENDPOINT)
const access = accessRead.data
const isLoading = computed(() => accessRead.pending.value)
const loadError = computed(() =>
	accessRead.error.value
		? resolveApiError(
				accessRead.error.value,
				'saas.public.suspended.load_error',
			)
		: null,
)
const isOpeningPortal = ref(false)

const reason = computed(() => access.value?.reason ?? null)
const reasonView = computed(() =>
	reason.value ? ACCESS_REASON_VIEWS[reason.value] : null,
)
const invoice = computed(() => access.value?.unpaidInvoice ?? null)
const invoiceAmount = computed(() =>
	invoice.value
		? formatMinorUnits(invoice.value.amount, invoice.value.currency)
		: '',
)
const owner = computed(() => access.value?.owners[0] ?? null)
const ownerName = computed(() => owner.value?.name || owner.value?.email || '')

const workspaceLine = computed(() => {
	const details = access.value
	if (!details) return ''
	const parts = [
		details.workspace.planName,
		t(
			'saas.public.suspended.members',
			{ count: details.workspace.memberCount },
			details.workspace.memberCount,
		),
		details.isTenantOwner ? t('saas.public.suspended.you_own') : null,
	]
	return parts.filter(Boolean).join(' · ')
})

function mediumDate(value: string | null | undefined): string {
	return value
		? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
				new Date(value),
			)
		: ''
}

// Deleted by an owner, not cancelled: who did it, and until when it can
// still be restored by choosing a plan again.
const deletionExplanation = computed(() => {
	const deletion = access.value?.deletion
	const params = {
		date: mediumDate(deletion?.at),
		until: mediumDate(access.value?.dataDeletionAt),
		name: deletion?.byName ?? '',
	}
	if (deletion?.isByCaller)
		return t('saas.public.suspended.reason.deleted_by_you', params)
	if (deletion?.byName)
		return t('saas.public.suspended.reason.deleted_by', params)
	return t('saas.public.suspended.reason.deleted', params)
})

const explanation = computed(() => {
	if (!reason.value) return ''
	if (reason.value === DELETED_REASON) return deletionExplanation.value
	if (invoice.value) {
		return t('saas.public.suspended.reason.unpaid_invoice', {
			invoice: invoice.value.number ?? invoiceAmount.value,
			amount: invoiceAmount.value,
		})
	}
	return t(`saas.public.suspended.reason.${reason.value}`)
})

const retentionLine = computed(() => {
	const deletionAt = access.value?.dataDeletionAt
	if (!deletionAt) return t('saas.public.suspended.retention.kept')
	return t('saas.public.suspended.retention.until', {
		date: mediumDate(deletionAt),
	})
})

/** The workspace owner's primary way back in, by reason. */
const ownerActionLabel = computed(() =>
	reason.value === 'suspended'
		? t('saas.public.suspended.owner.view_billing')
		: t(`saas.public.suspended.owner.action.${reason.value}`),
)

// Waiting for its first payment, the workspace already has its plan: the
// owner lands on that plan's payment, not on a page with nothing open.
const ownerActionPath = computed(() => {
	const planId = access.value?.workspace.planId
	if (reason.value === PENDING_PAYMENT_REASON && planId)
		return billingUpgradePath(planId)
	return reason.value && PLAN_CHOICE_REASONS.has(reason.value)
		? BILLING_CHOOSE_PLAN_PATH
		: BILLING_PATH
})

const mailtoOwner = computed(() =>
	owner.value
		? `mailto:${owner.value.email}?subject=${encodeURIComponent(
				t('saas.public.suspended.member.mail_subject', {
					workspace: access.value?.workspace.name ?? '',
				}),
			)}`
		: null,
)

function loadAccess(): Promise<void> {
	return accessRead.refresh()
}

function payInvoice(): void {
	const url = invoice.value?.hostedInvoiceUrl
	if (url) window.open(url, '_blank', 'noopener')
}

async function openPortal(): Promise<void> {
	isOpeningPortal.value = true
	try {
		const session = await $authFetch<PortalSession>(PORTAL_ENDPOINT, {
			method: 'POST',
			body: { returnUrl: window.location.href },
		})
		window.location.href = session.url
	} catch (error) {
		toast.add({
			color: 'error',
			title: t('saas.public.suspended.owner.portal_failed'),
			description: resolveApiError(
				error,
				'saas.public.suspended.owner.portal_failed_hint',
			),
		})
	} finally {
		isOpeningPortal.value = false
	}
}

async function signOut(): Promise<void> {
	await clearSession()
	await navigateDms(LOGIN_PATH)
}

// A workspace no longer blocked is entered again, from the browser. The
// billing data read before the suspension is not shown here, so the pages
// past this one read it afresh.
onMounted(() => {
	watch(
		() => access.value?.blocked,
		(blocked) => {
			if (blocked === false) void navigateDms(HOME_PATH)
		},
		{ immediate: true },
	)
})
</script>

<template>
	<div class="mx-auto flex w-full max-w-[640px] flex-col gap-4 py-2">
		<div
			v-if="isLoading && !access"
			class="flex flex-col gap-3"
			aria-busy="true"
		>
			<USkeleton class="h-16 w-full rounded-xl" />
			<USkeleton class="h-72 w-full rounded-xl" />
		</div>

		<DmsCard v-else-if="loadError && !access">
			<DmsEmptyState
				variant="error"
				:title="$t('saas.public.suspended.load_error')"
				:description="loadError"
				:actions="[
					{
						label: $t('saas.public.suspended.check_again'),
						icon: 'i-ph-arrows-clockwise',
						onClick: loadAccess,
					},
					{
						label: $t('saas.public.suspended.sign_out'),
						color: 'neutral',
						variant: 'outline',
						onClick: signOut,
					},
				]"
			/>
		</DmsCard>

		<template v-else-if="access?.blocked && reasonView">
			<DmsBanner
				v-if="loadError"
				tone="error"
				size="sm"
				icon="i-ph-warning-circle"
				:title="$t('saas.public.suspended.load_error')"
				:description="loadError"
			/>
			<DmsCard :padded="false" class="flex items-center gap-3 px-4 py-3">
				<DmsIconWell tone="muted" size="lg">
					<span class="font-mono text-xs font-semibold">
						{{ workspaceInitials(access.workspace.name) }}
					</span>
				</DmsIconWell>
				<div class="min-w-0 flex-1">
					<p class="text-highlighted truncate font-semibold">
						{{ access.workspace.name }}
					</p>
					<p class="text-muted truncate text-xs">{{ workspaceLine }}</p>
				</div>
				<DmsStatusPill
					:label="statusView('workspace', reasonView.status).label"
					:tone="statusView('workspace', reasonView.status).tone"
				/>
			</DmsCard>

			<DmsCard variant="elevated" class="flex flex-col gap-5">
				<div class="flex items-start gap-3">
					<DmsIconWell :icon="reasonView.icon" tone="error" size="xl" />
					<div>
						<h1 class="text-highlighted text-xl font-[650] tracking-[-0.025em]">
							{{ $t('saas.public.suspended.title') }}
						</h1>
						<p class="text-muted mt-1.5 text-[13px]">{{ explanation }}</p>
					</div>
				</div>

				<AccessTimeline
					v-if="access.timeline.length"
					:entries="access.timeline"
					:invoice="invoice"
				/>

				<p class="text-muted flex gap-1.5 text-xs">
					<UIcon name="i-ph-database" class="mt-0.5 size-3.5 shrink-0" />
					{{ retentionLine }}
				</p>

				<section
					v-if="access.isTenantOwner"
					class="border-default flex flex-col gap-3 border-t pt-4"
				>
					<DmsEyebrow
						as="h2"
						:label="$t('saas.public.suspended.owner.title')"
					/>
					<div class="flex flex-wrap gap-2">
						<UButton
							v-if="invoice?.hostedInvoiceUrl"
							icon="i-ph-arrow-square-out"
							:label="
								$t('saas.public.suspended.owner.pay', { amount: invoiceAmount })
							"
							@click="payInvoice"
						/>
						<UButton
							:to="ownerActionPath"
							icon="i-ph-credit-card"
							:color="invoice?.hostedInvoiceUrl ? 'neutral' : 'primary'"
							:variant="invoice?.hostedInvoiceUrl ? 'outline' : 'solid'"
							:label="ownerActionLabel"
						/>
						<UButton
							v-if="access.canManageInStripe"
							icon="i-ph-arrow-square-out"
							color="neutral"
							variant="ghost"
							:loading="isOpeningPortal"
							:label="$t('saas.public.suspended.owner.manage_in_stripe')"
							@click="openPortal"
						/>
					</div>
				</section>

				<section
					v-else
					class="border-default flex flex-col gap-3 border-t pt-4"
				>
					<DmsEyebrow
						as="h2"
						:label="$t('saas.public.suspended.member.title')"
					/>
					<DmsListRow
						v-if="owner"
						size="sm"
						icon="i-ph-user-circle"
						:title="
							$t('saas.public.suspended.member.ask', { owner: ownerName })
						"
						:description="owner.email"
					>
						<template #trailing>
							<UButton
								v-if="mailtoOwner"
								:to="mailtoOwner"
								external
								icon="i-ph-envelope-simple"
								size="xs"
								color="neutral"
								variant="outline"
								:label="
									$t('saas.public.suspended.member.email', { owner: ownerName })
								"
							/>
						</template>
					</DmsListRow>
					<p v-else class="text-muted text-[13px]">
						{{ $t('saas.public.suspended.member.no_owner') }}
					</p>
				</section>
			</DmsCard>

			<OtherWorkspaces
				v-if="access.otherWorkspaces.length"
				:workspaces="access.otherWorkspaces"
			/>

			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="text-muted text-xs">
					{{
						$t('saas.public.suspended.signed_in_as', {
							email: user?.email ?? '',
						})
					}}
				</p>
				<div class="flex gap-2">
					<UButton
						icon="i-ph-arrows-clockwise"
						color="neutral"
						variant="ghost"
						:loading="isLoading"
						:label="$t('saas.public.suspended.check_again')"
						@click="loadAccess"
					/>
					<UButton
						icon="i-ph-sign-out"
						color="neutral"
						variant="outline"
						:label="$t('saas.public.suspended.sign_out')"
						@click="signOut"
					/>
				</div>
			</div>
		</template>
	</div>
</template>
