<script setup lang="ts">
/**
 * "Workspace access restricted": why the workspace is closed and since when,
 * how the workspace owner reopens it, whom a member should ask, and the
 * caller's other workspaces. Reachable while the access gate blocks.
 */
import { computed, onMounted, ref } from 'vue'
import {
	ACCESS_REASON_VIEWS,
	workspaceInitials,
	type WorkspaceAccessDetails,
} from '../build/public/access'
import AccessTimeline from '../build/public/AccessTimeline.vue'
import OtherWorkspaces from '../build/public/OtherWorkspaces.vue'
import { BILLING_PATH, HOME_PATH, LOGIN_PATH } from '../build/public/routes'

const ACCESS_ENDPOINT = '/api/saas/workspace-access'
const PORTAL_ENDPOINT = '/api/saas/billing/portal-session'

interface PortalSession {
	url: string
}

const { t, locale } = useI18n()
const toast = useToast()
const { $authFetch } = useAuthFetch()
const { user, clear: clearSession } = useUserSession()
const { resolveApiError } = useApiErrorMessage()
const { formatMinorUnits } = useMoneyFormat()
const { statusView } = useSaasStatus()
const cachedAccess = useWorkspaceAccessCache()
const { data: billingStatusState } = useBillingStatus()
const { data: tenantPlanState } = useTenantPlan()

const access = ref<WorkspaceAccessDetails | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
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

const explanation = computed(() => {
	if (!reason.value) return ''
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
		date: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
			new Date(deletionAt),
		),
	})
})

/** The workspace owner's primary way back in, by reason. */
const ownerActionLabel = computed(() =>
	reason.value === 'suspended' || reason.value === 'cancelled'
		? t('saas.public.suspended.owner.view_billing')
		: t(`saas.public.suspended.owner.action.${reason.value}`),
)

const mailtoOwner = computed(() =>
	owner.value
		? `mailto:${owner.value.email}?subject=${encodeURIComponent(
				t('saas.public.suspended.member.mail_subject', {
					workspace: access.value?.workspace.name ?? '',
				}),
			)}`
		: null,
)

/**
 * Drop the payloads cached while blocked before going back in: an SPA
 * navigation keeps them alive, and Billing would keep announcing a
 * suspension the owner just settled.
 */
async function enterWorkspace(): Promise<void> {
	cachedAccess.value = null
	billingStatusState.value = null
	tenantPlanState.value = null
	await navigateDms(HOME_PATH)
}

async function loadAccess(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		access.value = await $authFetch<WorkspaceAccessDetails>(ACCESS_ENDPOINT)
		if (!access.value.blocked) await enterWorkspace()
	} catch (error) {
		loadError.value = resolveApiError(error, 'saas.public.suspended.load_error')
	} finally {
		isLoading.value = false
	}
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

onMounted(loadAccess)
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
							:to="BILLING_PATH"
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
