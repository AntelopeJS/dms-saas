<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import WorkspaceActionDialogs from '../build/workspace-detail/WorkspaceActionDialogs.vue'
import { useWorkspaceActions } from '../build/workspace-detail/useWorkspaceActions'
import { useWorkspaceOverview } from '../build/workspace-detail/useWorkspaceOverview'
import type { WorkspaceDialog } from '../build/workspace-detail/types'

/**
 * The head of a workspace's page: who it is (tile, name, status, plan,
 * workspace owner, creation), one primary action and the rest in a menu, the
 * danger action set apart. `?action=suspend|complimentary` opens that dialog,
 * which is how the workspace list's row menu reaches it.
 */
const props = defineProps<{ routeParams?: Record<string, string> }>()

const D = 'saas.workspace_detail.header'
const ACTION_QUERY = 'action'
const MAX_INITIALS = 2
const WORKSPACE_HOME = '/'

const tenantId = props.routeParams?.id ?? ''
const { t, locale } = useI18n()
const toast = useToast()
const route = useDmsRoute()
const router = useDmsRouter()
const { statusView } = useSaasStatus()
const { overview, isLoading, hasError, load } = useWorkspaceOverview(tenantId)
const actions = useWorkspaceActions(tenantId)
const dialogs = ref<InstanceType<typeof WorkspaceActionDialogs> | null>(null)

const status = computed(() => statusView('workspace', overview.value?.status))
const isSuspended = computed(() => overview.value?.status === 'suspended')
const isCancelled = computed(() => overview.value?.status === 'cancelled')
const isBilled = computed(() => !!overview.value?.hasStripeSubscription)

const initials = computed(() =>
	(overview.value?.name ?? '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_INITIALS)
		.map((word) => word[0]!.toLocaleUpperCase())
		.join(''),
)

const owner = computed(() => {
	const current = overview.value
	if (!current) return ''
	return current.ownerName || current.ownerEmail || t(`${D}.no_owner`)
})

function day(value: string | null | undefined): string {
	return formatDate(value, locale.value, { dateStyle: 'medium' }) ?? '—'
}

function openDialog(dialog: WorkspaceDialog): void {
	dialogs.value?.open(dialog)
}

async function copyLink(): Promise<void> {
	await navigator.clipboard.writeText(window.location.href.split('?')[0] ?? '')
	toast.add({
		title: t(`${D}.link_copied`),
		color: 'success',
		icon: 'i-ph-check-circle',
	})
}

/** An operator who joined opens the workspace itself, as its members do. */
async function openWorkspace(): Promise<void> {
	try {
		await useTenantSwitch(tenantId, WORKSPACE_HOME)
	} catch {
		toast.add({
			title: t(`${D}.open_error`),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	}
}

const primary = computed(() =>
	isBilled.value
		? {
				label: t(`${D}.change_plan`),
				icon: 'i-ph-arrow-circle-up',
				dialog: 'upgrade' as const,
			}
		: {
				label: t(`${D}.grant_free_access`),
				icon: 'i-ph-gift',
				dialog: 'complimentary' as const,
			},
)

const menu = computed<DropdownMenuItem[][]>(() => {
	const current = overview.value
	const support: DropdownMenuItem[] = [
		{
			label: current?.joinedAt ? t(`${D}.joined`) : t(`${D}.join`),
			icon: 'i-ph-user-plus',
			disabled: !!current?.joinedAt,
			onSelect: () => void actions.join(),
		},
		{
			label: isBilled.value
				? t(`${D}.grant_free_access`)
				: t(`${D}.immediate_upgrade`),
			icon: isBilled.value ? 'i-ph-gift' : 'i-ph-arrow-circle-up',
			disabled: !isBilled.value && !current?.stripeCustomerId,
			onSelect: () => openDialog(isBilled.value ? 'complimentary' : 'upgrade'),
		},
		{
			label: t(`${D}.grant_credit`),
			icon: 'i-ph-coins',
			disabled: !current?.stripeCustomerId,
			onSelect: () => openDialog('credit'),
		},
		{
			label: t(`${D}.open_in_stripe`),
			icon: 'i-ph-arrow-square-out',
			disabled: !current?.stripeCustomerUrl,
			to: current?.stripeCustomerUrl ?? undefined,
			target: '_blank',
		},
		{
			label: t(`${D}.copy_link`),
			icon: 'i-ph-link',
			onSelect: () => void copyLink(),
		},
	]
	const danger: DropdownMenuItem[] = [
		isSuspended.value
			? {
					label: t(`${D}.reactivate`),
					icon: 'i-ph-play-circle',
					onSelect: () => void actions.reactivate(),
				}
			: {
					label: t(`${D}.suspend`),
					icon: 'i-ph-prohibit',
					color: 'error',
					disabled: isCancelled.value,
					onSelect: () => void actions.suspend(),
				},
	]
	return [support, danger]
})

const QUERY_ACTIONS: Record<string, () => void> = {
	suspend: () => void actions.suspend(),
	complimentary: () => openDialog('complimentary'),
}

// The list's row menu opens a dialog here: run it once the workspace is
// loaded, then drop the query so a reload does not open it again.
watch(overview, async (current) => {
	const requested = route.query[ACTION_QUERY]
	if (!current || typeof requested !== 'string') return
	const { [ACTION_QUERY]: _action, ...query } = route.query
	await router.replace({ query })
	QUERY_ACTIONS[requested]?.()
})
</script>

<template>
	<div>
		<div v-if="isLoading && !overview" class="flex items-center gap-4">
			<USkeleton class="size-12 rounded-xl" />
			<div class="flex flex-col gap-2">
				<USkeleton class="h-6 w-56" />
				<USkeleton class="h-4 w-80" />
			</div>
		</div>
		<DmsEmptyState
			v-else-if="hasError && !overview"
			variant="error"
			size="sm"
			:title="$t(`${D}.load_error`)"
			:description="$t(`${D}.load_error_description`)"
			:actions="[{ label: $t('saas.workspace_detail.retry'), onClick: load }]"
		/>
		<div v-else-if="overview" class="flex flex-wrap items-start gap-4">
			<div
				class="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-xl text-lg font-semibold"
				aria-hidden="true"
			>
				{{ initials }}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-highlighted truncate text-xl font-semibold">
						{{ overview.name }}
					</h1>
					<DmsStatusPill :tone="status.tone" :label="status.label" />
					<UBadge v-if="overview.planName" color="neutral" variant="soft">
						{{ overview.planName }}
					</UBadge>
					<UBadge
						v-if="overview.isComplimentary"
						color="primary"
						variant="soft"
					>
						{{ $t(`${D}.complimentary`) }}
					</UBadge>
				</div>
				<div
					class="text-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
				>
					<span class="font-mono text-xs">{{ overview._id }}</span>
					<span>
						{{ $t(`${D}.workspace_owner`) }}
						<span class="text-default font-medium">{{ owner }}</span>
						<span
							v-if="
								overview.ownerStatus !== 'joined' &&
								overview.ownerStatus !== 'none'
							"
						>
							· {{ $t(`saas.status.owner.${overview.ownerStatus}`) }}
						</span>
					</span>
					<span>
						{{ $t(`${D}.created`, { date: day(overview.createdAt) }) }}
					</span>
					<span v-if="overview.joinedAt" class="text-success">
						{{ $t(`${D}.joined_as_support`, { date: day(overview.joinedAt) }) }}
					</span>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<UBadge
					v-if="overview.joinedAt"
					color="success"
					variant="subtle"
					icon="i-ph-check"
				>
					{{ $t(`${D}.joined`) }}
				</UBadge>
				<UButton
					v-if="overview.joinedAt"
					color="neutral"
					variant="outline"
					icon="i-ph-arrow-square-out"
					@click="openWorkspace"
				>
					{{ $t(`${D}.open_workspace`) }}
				</UButton>
				<UButton
					v-if="!isCancelled"
					color="primary"
					:icon="primary.icon"
					@click="openDialog(primary.dialog)"
				>
					{{ primary.label }}
				</UButton>
				<UDropdownMenu :items="menu" :content="{ align: 'end' }">
					<UButton
						color="neutral"
						variant="outline"
						icon="i-ph-dots-three-outline"
						:aria-label="$t(`${D}.more_actions`)"
					/>
				</UDropdownMenu>
			</div>
		</div>
		<WorkspaceActionDialogs
			v-if="overview"
			ref="dialogs"
			:tenant-id="tenantId"
			:workspace-name="overview.name"
		/>
	</div>
</template>
