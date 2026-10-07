<script setup lang="ts">
import { computed, h, onMounted } from 'vue'
import { DATA_EXPORT_PATH, HOME_PATH } from '../build/workspace-paths'

const DELETE_ENDPOINT = '/api/saas/workspaces/current/delete'
const CONFIRMATION_MISMATCH =
	'saas.errors.workspace.delete_confirmation_mismatch'
const KEYS = 'saas.workspace.general'
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

const { t, locale } = useI18n()
const { $authFetch } = useAuthFetch()
const { confirm } = useConfirm()
const { resolveApiError } = useApiErrorMessage()
const toast = useToast()
const { data: overview, error, refresh } = useWorkspaceOverview()

const destroyedOn = computed(
	() =>
		formatDate(overview.value?.destroyedAt, locale.value, DATE_FORMAT) ?? '—',
)

const deleteSummary = computed(() => {
	const view = overview.value
	if (!view) return ''
	return t(`${KEYS}.delete.description`, {
		members: t(`${KEYS}.delete.members_count`, view.seats.members),
		invites: t(`${KEYS}.delete.invites_count`, view.seats.pendingInvites),
		days: view.retentionDays,
	})
})

const subscriptionLine = computed(() => {
	const view = overview.value
	if (!view?.plan) return null
	return view.unpaidInvoiceNumber
		? t(`${KEYS}.delete.subscription_stops_unpaid`, {
				plan: view.plan.name,
				invoice: view.unpaidInvoiceNumber,
			})
		: t(`${KEYS}.delete.subscription_stops`, { plan: view.plan.name })
})

function impactOf(view: WorkspaceOverview): ConfirmImpact[] {
	const impact: ConfirmImpact[] = [
		{
			icon: 'i-ph-users',
			label: t(`${KEYS}.delete.impact_members`),
			count: view.seats.members,
		},
		{
			icon: 'i-ph-envelope-simple',
			label: t(`${KEYS}.delete.impact_invites`),
			count: view.seats.pendingInvites,
		},
		{
			icon: 'i-ph-database',
			label: t(`${KEYS}.delete.impact_data`),
			count: destroyedOn.value,
		},
		{
			icon: 'i-ph-receipt',
			label: t(`${KEYS}.delete.impact_invoices`),
			count: view.invoicesCount,
		},
	]
	if (view.plan) {
		impact.push({
			icon: 'i-ph-stack',
			label: t(`${KEYS}.delete.impact_subscription`, { plan: view.plan.name }),
			count: t(`${KEYS}.delete.impact_subscription_stops`),
		})
	}
	return impact
}

function renderConfirmNotes(view: WorkspaceOverview) {
	const landing = view.nextWorkspace
		? t(`${KEYS}.delete.next_workspace`, { name: view.nextWorkspace.name })
		: t(`${KEYS}.delete.no_next_workspace`)
	return () =>
		h('div', { class: 'flex flex-col gap-1.5 text-sm text-muted' }, [
			h('p', t(`${KEYS}.delete.export_hint`)),
			h('p', landing),
		])
}

async function leaveDeletedWorkspace(view: WorkspaceOverview): Promise<void> {
	// Staying would land on the access-restricted screen: the gate refuses a
	// cancelled workspace. The server already named the next one.
	if (view.nextWorkspace) {
		await useTenantSwitch(view.nextWorkspace._id, HOME_PATH)
		return
	}
	window.location.href = HOME_PATH
}

async function deleteWorkspace(view: WorkspaceOverview): Promise<void> {
	try {
		await $authFetch(DELETE_ENDPOINT, {
			method: 'POST',
			body: { confirmName: view.name },
		})
	} catch (failure) {
		const message = resolveApiError(failure, `${KEYS}.error.delete`)
		if (readApiErrorKey(failure) === CONFIRMATION_MISMATCH) {
			throw new ConfirmTextError(message)
		}
		throw new Error(message)
	}
	toast.add({
		title: t(`${KEYS}.delete.deleted`, { name: view.name }),
		color: 'success',
		icon: 'i-ph-check-circle',
	})
	await leaveDeletedWorkspace(view)
}

async function openDeleteConfirm(): Promise<void> {
	const view = overview.value
	if (!view) return
	await confirm({
		title: t(`${KEYS}.delete.confirm_title`, { name: view.name }),
		description: t(`${KEYS}.delete.confirm_description`, {
			days: view.retentionDays,
			date: destroyedOn.value,
		}),
		color: 'error',
		icon: 'i-ph-trash',
		confirmLabel: t(`${KEYS}.delete.submit`),
		confirmIcon: 'i-ph-trash',
		initialFocus: 'cancel',
		impact: impactOf(view),
		confirmText: view.name,
		body: renderConfirmNotes(view),
		onConfirm: () => deleteWorkspace(view),
	})
}

onMounted(refresh)
</script>

<template>
	<div class="divide-default flex flex-col divide-y">
		<DmsFieldRow
			:label="$t(`${KEYS}.export.title`)"
			:description="
				$t(`${KEYS}.export.description`, { name: overview?.name ?? '' })
			"
		>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-ph-download-simple"
				:to="DATA_EXPORT_PATH"
			>
				{{ $t(`${KEYS}.export.action`) }}
			</UButton>
		</DmsFieldRow>
		<DmsFieldRow :label="$t(`${KEYS}.delete.title`)">
			<template #details>
				<USkeleton v-if="!overview && !error" class="mt-1 h-10 w-full" />
				<DmsSaasLoadFailure
					v-else-if="error && !overview"
					class="mt-1"
					:title="$t(`${KEYS}.glance.load_failed`)"
					@retry="refresh"
				/>
				<div v-else class="text-muted mt-0.5 flex flex-col gap-1 text-[12.5px]">
					<p>{{ deleteSummary }}</p>
					<p class="flex items-center gap-1.5">
						<UIcon name="i-ph-archive" class="size-3.5 shrink-0" />
						{{ $t(`${KEYS}.delete.invoices_kept`) }}
					</p>
					<p v-if="subscriptionLine" class="flex items-center gap-1.5">
						<UIcon name="i-ph-stack" class="size-3.5 shrink-0" />
						{{ subscriptionLine }}
					</p>
				</div>
			</template>
			<UButton
				color="error"
				variant="outline"
				icon="i-ph-trash"
				:disabled="!overview"
				@click="openDeleteConfirm"
			>
				{{ $t(`${KEYS}.delete.action`) }}
			</UButton>
		</DmsFieldRow>
	</div>
</template>
