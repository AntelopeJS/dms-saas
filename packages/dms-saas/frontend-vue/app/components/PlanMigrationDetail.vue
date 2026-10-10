<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
	attentionWorkspaces,
	isMigrationLive,
	type MigrationDetail,
	type MigrationWorkspace,
	type StripeReading,
	WORKSPACE_STATUS_TONES,
} from '../build/plan-migration'

const REFRESH_INTERVAL_MS = 4_000
const ROWS_PREVIEW = 8
const NOTE_MAX_LENGTH = 500
const NOTE_FIELD = 'note'

const props = defineProps<{
	routeParams?: Record<string, string>
	endpoint?: string
	listUrl?: string
}>()

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { statusView } = useSaasStatus()

const migration = ref<MigrationDetail | null>(null)
const isLoading = ref(true)
const hasError = ref(false)
const readings = ref<Record<string, StripeReading | 'loading'>>({})
const showAllRows = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const base = computed(
	() =>
		`${props.endpoint ?? '/api/saas/plan-migrations'}/${props.routeParams?.id ?? ''}`,
)
const attention = computed(() =>
	attentionWorkspaces(migration.value?.workspaces ?? []),
)
const shownRows = computed(() => {
	const rows = migration.value?.workspaces ?? []
	return showAllRows.value ? rows : rows.slice(0, ROWS_PREVIEW)
})
const hiddenRows = computed(
	() => (migration.value?.workspaces.length ?? 0) - shownRows.value.length,
)
const firstUncertain = computed(() =>
	attention.value.find((row) => row.isUncertain),
)

const facts = computed(() => {
	const totals = migration.value?.totals
	if (!totals) return []
	return [
		{
			id: 'captured',
			icon: 'i-ph-camera',
			eyebrow: t('saas.catalog.migrations.detail.captured'),
			value: totals.captured,
		},
		{
			id: 'moved',
			icon: 'i-ph-check-circle',
			tone: 'success' as const,
			eyebrow: t('saas.catalog.migrations.detail.moved'),
			value: totals.moved,
		},
		{
			id: 'not-moved',
			icon: 'i-ph-warning-circle',
			tone: totals.notMoved > 0 ? ('error' as const) : undefined,
			eyebrow: t('saas.catalog.migrations.detail.not_moved'),
			value: totals.notMoved,
		},
		{
			id: 'notified',
			icon: 'i-ph-bell',
			eyebrow: t('saas.catalog.migrations.detail.notified'),
			value: totals.notified,
		},
	]
})

function formatDate(value: string | null): string {
	if (!value) return '—'
	return new Date(value).toLocaleString(locale.value, {
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { timeStyle: 'short' }

/** "14:31" on the day the migration started, the full date on another one. */
function formatRowTime(value: string | null): string {
	if (!value || !migration.value) return formatDate(value)
	const sameDay =
		new Date(value).toDateString() ===
		new Date(migration.value.createdAt).toDateString()
	return sameDay
		? new Date(value).toLocaleTimeString(locale.value, TIME_FORMAT)
		: formatDate(value)
}

function workspaceStatus(row: MigrationWorkspace) {
	return {
		tone: WORKSPACE_STATUS_TONES[row.status],
		label: t(`saas.catalog.migrations.workspace_status.${row.status}`),
	}
}

async function load(): Promise<void> {
	hasError.value = false
	try {
		migration.value = await $authFetch<MigrationDetail>(base.value)
	} catch {
		hasError.value = true
	} finally {
		isLoading.value = false
	}
	scheduleRefresh()
}

function scheduleRefresh(): void {
	const isLive = migration.value
		? isMigrationLive(migration.value.status)
		: false
	if (isLive && !refreshTimer)
		refreshTimer = setInterval(load, REFRESH_INTERVAL_MS)
	if (!isLive && refreshTimer) {
		clearInterval(refreshTimer)
		refreshTimer = undefined
	}
}

async function readStripe(row: MigrationWorkspace): Promise<void> {
	readings.value = { ...readings.value, [row.tenantId]: 'loading' }
	try {
		const reading = await $authFetch<StripeReading>(
			`${base.value}/workspaces/${row.tenantId}/stripe`,
		)
		readings.value = { ...readings.value, [row.tenantId]: reading }
	} catch {
		readings.value = {
			...readings.value,
			[row.tenantId]: {
				stripeSubscriptionId: null,
				stripePlan: 'unavailable',
				stripePlanName: null,
				dmsPlanName: null,
			},
		}
	}
}

function readingOf(row: MigrationWorkspace): StripeReading | null {
	const reading = readings.value[row.tenantId]
	return reading && reading !== 'loading' ? reading : null
}

async function resolve(
	row: MigrationWorkspace,
	resolution: 'moved' | 'not_moved',
): Promise<void> {
	const current = migration.value
	if (!current) return
	const isMoved = resolution === 'moved'
	await confirm({
		title: t(`saas.catalog.migrations.resolve.${resolution}_title`, {
			name: row.name,
		}),
		description: t(
			`saas.catalog.migrations.resolve.${resolution}_description`,
			{
				name: row.name,
				from: current.from.name,
				to: current.to.name,
			},
		),
		color: isMoved ? 'primary' : 'warning',
		icon: isMoved ? 'i-ph-check-circle' : 'i-ph-arrow-counter-clockwise',
		confirmLabel: t(`saas.catalog.migrations.resolve.${resolution}_confirm`),
		onConfirm: async () => {
			await $authFetch(`${base.value}/workspaces/${row.tenantId}/resolve`, {
				method: 'POST',
				body: { resolution },
			})
			await load()
		},
	})
}

async function retry(): Promise<void> {
	const current = migration.value
	if (!current) return
	const failed = current.workspaces.filter((row) => row.status === 'failed')
	await confirm({
		title: t(
			'saas.catalog.migrations.retry.title',
			{
				count: failed.length,
				name: failed[0]?.name ?? '',
				to: current.to.name,
			},
			failed.length,
		),
		description: t('saas.catalog.migrations.retry.description', {
			from: current.from.name,
		}),
		color: 'primary',
		icon: 'i-ph-arrows-clockwise',
		impact: [
			{
				icon: 'i-ph-buildings',
				label: t('saas.catalog.migrations.retry.impact_retried'),
				count: failed.length,
			},
			...(current.totals.uncertain > 0
				? [
						{
							icon: 'i-ph-question',
							label: t('saas.catalog.migrations.retry.impact_skipped'),
							count: current.totals.uncertain,
						},
					]
				: []),
		],
		confirmLabel: t(
			'saas.catalog.migrations.retry.confirm',
			{ count: failed.length },
			failed.length,
		),
		onConfirm: async () => {
			await $authFetch(`${base.value}/retry`, { method: 'POST' })
			toast.add({
				color: 'success',
				icon: 'i-ph-arrows-clockwise',
				title: t('saas.catalog.migrations.retry.started'),
			})
			await load()
		},
	})
}

async function reconcile(): Promise<void> {
	const current = migration.value
	if (!current) return
	await confirm({
		title: t(
			'saas.catalog.migrations.reconcile.title',
			{ count: current.totals.notMoved, from: current.from.name },
			current.totals.notMoved,
		),
		description: t('saas.catalog.migrations.reconcile.description', {
			from: current.from.name,
		}),
		color: 'warning',
		icon: 'i-ph-check-square',
		confirmLabel: t('saas.catalog.migrations.reconcile.confirm'),
		// A note of blanks passes the dialog's required check: the server
		// refuses it under the field.
		fields: [
			{
				id: NOTE_FIELD,
				label: t('saas.catalog.migrations.reconcile.note'),
				type: 'string',
				required: true,
				component: {
					componentName: 'DmsTextarea',
					options: {
						rows: 3,
						maxlength: NOTE_MAX_LENGTH,
						placeholder: t(
							'saas.catalog.migrations.reconcile.note_placeholder',
						),
					},
				},
			},
		],
		onConfirm: async (values) => {
			await $authFetch(`${base.value}/reconcile`, {
				method: 'POST',
				body: { note: String(values[NOTE_FIELD] ?? '').trim() },
			})
			await load()
		},
	})
}

onMounted(load)
onBeforeUnmount(() => {
	if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
	<div class="flex flex-col gap-5">
		<div v-if="isLoading" class="flex flex-col gap-3">
			<USkeleton class="h-8 w-1/3" />
			<USkeleton class="h-20 w-full" />
			<USkeleton class="h-48 w-full" />
		</div>
		<DmsCard v-else-if="hasError && !migration">
			<DmsEmptyState
				variant="error"
				:title="$t('saas.catalog.migrations.detail.failed')"
				:description="$t('saas.catalog.migrations.detail.failed_description')"
			>
				<template #actions>
					<UButton
						icon="i-ph-arrow-clockwise"
						color="neutral"
						variant="outline"
						@click="load"
					>
						{{ $t('saas.common.retry') }}
					</UButton>
				</template>
			</DmsEmptyState>
		</DmsCard>

		<template v-else-if="migration">
			<UButton
				v-if="listUrl"
				:to="listUrl"
				class="self-start"
				size="xs"
				color="neutral"
				variant="link"
				icon="i-ph-arrow-left"
			>
				{{ $t('saas.catalog.migrations.detail.back') }}
			</UButton>
			<div class="flex flex-wrap items-center gap-3">
				<DmsIconWell icon="i-ph-arrows-clockwise" tone="primary" />
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-highlighted text-lg font-semibold">
							{{ migration.from.name }} → {{ migration.to.name }}
						</h2>
						<DmsStatusPill
							:tone="statusView('migration', migration.status).tone"
							:label="statusView('migration', migration.status).label"
							:dot="migration.status === 'running' ? 'live' : 'static'"
						/>
					</div>
					<p class="text-muted text-sm">
						{{
							$t('saas.catalog.migrations.detail.started', {
								date: formatDate(migration.createdAt),
								name: migration.startedBy,
								reason: $t(
									`saas.catalog.migrations.reason.${migration.reason ?? 'plan_retired'}`,
								),
							})
						}}
					</p>
				</div>
			</div>

			<DmsStatGroup :items="facts" />

			<DmsBanner
				v-if="migration.reconciliation"
				tone="info"
				icon="i-ph-check-square"
				:title="
					$t('saas.catalog.migrations.detail.reconciled', {
						date: formatDate(migration.reconciliation.at),
						name: migration.reconciliation.by,
					})
				"
				:description="migration.reconciliation.note"
			/>

			<DmsCard
				v-if="attention.length > 0"
				:title="$t('saas.catalog.migrations.detail.attention')"
				:count="attention.length"
			>
				<ul class="divide-default -mx-4 divide-y">
					<li
						v-for="row in attention"
						:key="row.tenantId"
						class="flex flex-col gap-2 px-4 py-3"
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-highlighted font-medium">{{ row.name }}</span>
							<DmsStatusPill
								size="sm"
								:tone="workspaceStatus(row).tone"
								:label="workspaceStatus(row).label"
							/>
						</div>
						<p class="text-muted text-sm">
							{{
								row.isUncertain
									? $t('saas.catalog.migrations.detail.uncertain_hint')
									: $t('saas.catalog.migrations.detail.failed_hint', {
											from: migration.from.name,
										})
							}}
						</p>
						<p v-if="row.error" class="text-dimmed font-mono text-xs">
							{{ row.error }}
						</p>
						<template v-if="row.isUncertain">
							<div
								v-if="readingOf(row)"
								class="bg-elevated/50 flex flex-wrap gap-x-4 gap-y-1 rounded-md px-3 py-2 text-xs"
							>
								<span
									v-if="readingOf(row)?.stripeSubscriptionId"
									class="font-mono"
								>
									{{ readingOf(row)?.stripeSubscriptionId }}
								</span>
								<span>
									{{ $t('saas.catalog.migrations.detail.stripe_says') }}
									<b>
										{{
											readingOf(row)?.stripePlanName ??
											$t(
												`saas.catalog.migrations.detail.stripe_${readingOf(row)?.stripePlan}`,
											)
										}}
									</b>
								</span>
								<span>
									{{ $t('saas.catalog.migrations.detail.dms_says') }}
									<b>{{ readingOf(row)?.dmsPlanName ?? '—' }}</b>
								</span>
							</div>
							<div class="flex flex-wrap gap-2">
								<UButton
									v-if="!readingOf(row)"
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-ph-stripe-logo"
									:loading="readings[row.tenantId] === 'loading'"
									@click="readStripe(row)"
								>
									{{ $t('saas.catalog.migrations.detail.check_stripe') }}
								</UButton>
								<UButton
									size="xs"
									icon="i-ph-check"
									:disabled="!migration.abilities.canResolve"
									@click="resolve(row, 'moved')"
								>
									{{
										$t('saas.catalog.migrations.detail.mark_moved', {
											plan: migration.to.name,
										})
									}}
								</UButton>
								<UButton
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-ph-arrow-counter-clockwise"
									:disabled="!migration.abilities.canResolve"
									@click="resolve(row, 'not_moved')"
								>
									{{
										$t('saas.catalog.migrations.detail.allow_retry', {
											plan: migration.from.name,
										})
									}}
								</UButton>
							</div>
						</template>
					</li>
				</ul>
			</DmsCard>

			<DmsCard
				v-if="
					migration.permissions.added.length +
						migration.permissions.removed.length >
					0
				"
				:title="$t('saas.catalog.migrations.detail.changes')"
			>
				<p class="text-muted text-sm">
					{{
						$t('saas.catalog.migrations.detail.permissions_changed', {
							added: migration.permissions.added.length,
							removed: migration.permissions.removed.length,
						})
					}}
				</p>
			</DmsCard>

			<DmsCard
				:title="$t('saas.catalog.migrations.detail.all_workspaces')"
				:count="migration.workspaces.length"
			>
				<p
					v-if="migration.workspaces.length === 0"
					class="text-muted py-4 text-center text-sm"
				>
					{{ $t('saas.catalog.migrations.detail.no_workspace') }}
				</p>
				<ul v-else class="divide-default -mx-4 divide-y">
					<li
						v-for="row in shownRows"
						:key="row.tenantId"
						class="flex items-center gap-3 px-4 py-2 text-sm"
					>
						<span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
						<DmsStatusPill
							size="sm"
							:tone="workspaceStatus(row).tone"
							:label="workspaceStatus(row).label"
						/>
						<span class="text-dimmed w-36 text-right text-xs tabular-nums">
							{{ formatRowTime(row.updatedAt) }}
						</span>
					</li>
				</ul>
				<UButton
					v-if="hiddenRows > 0"
					class="mt-2"
					size="xs"
					variant="link"
					@click="showAllRows = true"
				>
					{{
						$t('saas.catalog.migrations.detail.show_all', { count: hiddenRows })
					}}
				</UButton>
			</DmsCard>

			<div
				v-if="
					migration.abilities.canRetry ||
					migration.abilities.canReconcile ||
					firstUncertain
				"
				class="flex flex-wrap items-center justify-end gap-2"
			>
				<span
					v-if="firstUncertain"
					class="text-muted mr-auto flex items-center gap-1.5 text-xs"
				>
					<UIcon name="i-ph-info" class="size-4" />
					{{
						$t('saas.catalog.migrations.detail.resolve_first', {
							name: firstUncertain.name,
						})
					}}
				</span>
				<UButton
					color="neutral"
					variant="outline"
					icon="i-ph-check-square"
					:disabled="!migration.abilities.canReconcile"
					@click="reconcile"
				>
					{{ $t('saas.catalog.migrations.detail.mark_reconciled') }}
				</UButton>
				<UButton
					v-if="migration.totals.failed > 0"
					icon="i-ph-arrows-clockwise"
					:disabled="!migration.abilities.canRetry"
					@click="retry"
				>
					{{
						$t('saas.catalog.migrations.detail.retry_failed', {
							count: migration.totals.failed,
						})
					}}
				</UButton>
			</div>
		</template>
	</div>
</template>
