<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const KEYS = 'saas.workspace.data_export.history'
const SKELETON_ROWS = 3
const MOMENT_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
}
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

/** What a row says about its archive; `expired` outlives every status. */
type ExportRowState = 'ready' | 'partial' | 'expired' | 'failed' | 'pending'

const ROW_TONES: Record<ExportRowState, SaasTone> = {
	ready: 'success',
	partial: 'warning',
	expired: 'neutral',
	failed: 'error',
	pending: 'info',
}

const { t, locale } = useI18n()
const { resolveApiError } = useApiErrorMessage()
const toast = useToast()
const { state, running, load, refresh, goToPage, start, download } =
	useExportHistory()

const downloadingJobId = ref<string | null>(null)

const isFirstLoad = computed(
	() => !state.value.hasLoaded && !state.value.hasFailed,
)
const showPager = computed(
	() =>
		state.value.hasLoaded &&
		!state.value.hasFailed &&
		(state.value.page > 1 || state.value.hasMore),
)

function rowState(entry: ExportHistoryEntry): ExportRowState {
	if (entry.status === EXPORT_STATUS.failed) return 'failed'
	if (entry.status === EXPORT_STATUS.pending) return 'pending'
	if (isExportExpired(entry, Date.now())) return 'expired'
	return entry.result?.partial ? 'partial' : 'ready'
}

function format(
	value: string | undefined,
	options: Intl.DateTimeFormatOptions,
): string {
	return formatDate(value, locale.value, options) ?? '—'
}

function availability(entry: ExportHistoryEntry): string {
	const date = format(entry.expiresAt, DAY_FORMAT)
	const texts: Record<ExportRowState, string> = {
		ready: t(`${KEYS}.available_until`, { date }),
		partial: t(`${KEYS}.available_until`, { date }),
		expired: t(`${KEYS}.expired_since`, { date }),
		failed: t(`${KEYS}.failed_detail`),
		pending: t(`${KEYS}.pending_detail`, {
			progress: Math.round(entry.progress),
		}),
	}
	return texts[rowState(entry)]
}

function detail(entry: ExportHistoryEntry): string {
	const failures = entry.result?.failures.length ?? 0
	if (rowState(entry) === 'partial') {
		return t(`${KEYS}.partial_detail`, failures)
	}
	return t('saas.workspace.data_export.scope')
}

function notifyError(error: unknown, fallbackKey: string): void {
	toast.add({
		title: resolveApiError(error, fallbackKey),
		color: 'error',
		icon: 'i-ph-warning-circle',
	})
}

async function downloadEntry(entry: ExportHistoryEntry): Promise<void> {
	if (downloadingJobId.value) return
	downloadingJobId.value = entry.jobId
	await download(entry.jobId, entry)
		.catch((error) =>
			notifyError(error, 'saas.workspace.data_export.error.download'),
		)
		.finally(() => {
			downloadingJobId.value = null
		})
}

function requestAnother(): Promise<void> {
	return start().catch((error) =>
		notifyError(error, 'saas.workspace.data_export.error.start'),
	)
}

onMounted(() => {
	void refresh()
})
</script>

<template>
	<DmsCard :title="$t(`${KEYS}.title`)" :padded="false">
		<p class="text-muted border-default px-4.5 border-b py-2.5 text-xs">
			{{ $t(`${KEYS}.description`) }}
		</p>

		<div v-if="isFirstLoad" class="flex flex-col gap-2 p-4" aria-busy="true">
			<USkeleton v-for="row in SKELETON_ROWS" :key="row" class="h-12 w-full" />
		</div>

		<DmsEmptyState
			v-else-if="state.hasFailed"
			variant="error"
			size="sm"
			:title="$t(`${KEYS}.error_load`)"
			:description="$t(`${KEYS}.error_load_description`)"
			:actions="[
				{
					label: $t('saas.common.retry'),
					icon: 'i-ph-arrow-clockwise',
					color: 'neutral',
					variant: 'outline',
					loading: state.isLoading,
					onClick: () => load(),
				},
			]"
		/>

		<DmsEmptyState
			v-else-if="!state.entries.length"
			size="sm"
			icon="i-ph-archive"
			:title="$t(`${KEYS}.empty_title`)"
			:description="$t(`${KEYS}.empty_description`)"
			:actions="[
				{
					label: $t('saas.workspace.data_export.request'),
					icon: 'i-ph-download-simple',
					loading: state.isStarting,
					onClick: requestAnother,
				},
			]"
		/>

		<ul v-else class="divide-default divide-y" :aria-busy="state.isLoading">
			<li
				v-for="entry in state.entries"
				:key="entry.jobId"
				class="px-4.5 flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm"
			>
				<div class="flex min-w-48 grow flex-col gap-0.5">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-highlighted tabular-nums">
							{{ format(entry.createdAt, MOMENT_FORMAT) }}
						</span>
						<DmsStatusPill
							size="sm"
							:tone="ROW_TONES[rowState(entry)]"
							:label="$t(`${KEYS}.status.${rowState(entry)}`)"
						/>
					</div>
					<span class="text-muted text-xs">{{ detail(entry) }}</span>
				</div>
				<span
					class="min-w-40 text-xs"
					:class="rowState(entry) === 'failed' ? 'text-error' : 'text-muted'"
				>
					{{ availability(entry) }}
				</span>
				<UButton
					v-if="rowState(entry) === 'ready' || rowState(entry) === 'partial'"
					color="neutral"
					variant="outline"
					size="sm"
					icon="i-ph-download-simple"
					:loading="downloadingJobId === entry.jobId"
					:disabled="!!downloadingJobId && downloadingJobId !== entry.jobId"
					@click="downloadEntry(entry)"
				>
					{{ $t(`${KEYS}.download`) }}
				</UButton>
				<UButton
					v-else-if="rowState(entry) !== 'pending'"
					color="neutral"
					variant="ghost"
					size="sm"
					:icon="
						rowState(entry) === 'failed' ? 'i-ph-arrow-clockwise' : 'i-ph-plus'
					"
					:disabled="!!running"
					:loading="state.isStarting"
					@click="requestAnother"
				>
					{{
						rowState(entry) === 'failed'
							? $t(`${KEYS}.retry`)
							: $t(`${KEYS}.request_new`)
					}}
				</UButton>
			</li>
		</ul>

		<template v-if="showPager" #footer>
			<div class="flex items-center justify-between gap-3">
				<UButton
					color="neutral"
					variant="ghost"
					size="sm"
					icon="i-ph-caret-left"
					:disabled="state.page <= 1 || state.isLoading"
					@click="goToPage(state.page - 1)"
				>
					{{ $t(`${KEYS}.previous`) }}
				</UButton>
				<span class="text-muted text-xs tabular-nums">
					{{ $t(`${KEYS}.page`, { page: state.page }) }}
				</span>
				<UButton
					color="neutral"
					variant="ghost"
					size="sm"
					icon="i-ph-caret-right"
					trailing
					:disabled="!state.hasMore || state.isLoading"
					@click="goToPage(state.page + 1)"
				>
					{{ $t(`${KEYS}.next`) }}
				</UButton>
			</div>
		</template>
	</DmsCard>
</template>
