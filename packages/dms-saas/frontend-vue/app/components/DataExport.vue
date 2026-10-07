<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** Query parameter a delivered export link carries, set by the DMS. */
const EXPORT_JOB_QUERY_PARAM = 'exportJob'
const KEYS = 'saas.workspace.data_export'
const POLL_INTERVAL_MS = 2000
const FULL_PROGRESS = 100
/** Statuses saying the archive is gone for good, not momentarily unreachable. */
const GONE_STATUSES = new Set([404, 410])
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour: '2-digit',
	minute: '2-digit',
}

const { t, locale } = useI18n()
const { user } = useCurrentUser()
const { resolveApiError } = useApiErrorMessage()
const route = useDmsRoute()
const router = useDmsRouter()
const toast = useToast()
const { state, running, load, refresh, start, readStatus, download } =
	useExportHistory()

/** The export this visit watched finish, shown until the page is left. */
const finished = ref<ExportHistoryEntry | null>(null)
/** The e-mailed link this visit came from, once the server said it is gone. */
const expiredLinkJobId = ref<string | null>(null)
const isDownloading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const email = computed(() => user.value?.email ?? '')
const progress = computed(() =>
	Math.min(FULL_PROGRESS, Math.round(running.value?.progress ?? 0)),
)
const isFinishedPartial = computed(() => !!finished.value?.result?.partial)

function formatDay(value: string | undefined): string {
	return formatDate(value, locale.value, DAY_FORMAT) ?? '—'
}

function formatTime(value: string | undefined): string {
	return formatDate(value, locale.value, TIME_FORMAT) ?? '—'
}

interface HttpErrorLike {
	statusCode?: unknown
	status?: unknown
}

function errorStatus(error: unknown): number | undefined {
	const candidate = error as HttpErrorLike | null
	const status = candidate?.statusCode ?? candidate?.status
	return typeof status === 'number' ? status : undefined
}

function notifyError(error: unknown, fallbackKey: string): void {
	toast.add({
		title: resolveApiError(error, fallbackKey),
		color: 'error',
		icon: 'i-ph-warning-circle',
	})
}

async function requestExport(): Promise<void> {
	finished.value = null
	expiredLinkJobId.value = null
	await start().catch((error) => notifyError(error, `${KEYS}.error.start`))
}

async function downloadFinished(): Promise<void> {
	if (!finished.value || isDownloading.value) return
	isDownloading.value = true
	await download(finished.value.jobId, finished.value)
		.catch((error) => notifyError(error, `${KEYS}.error.download`))
		.finally(() => {
			isDownloading.value = false
		})
}

async function pollRunning(): Promise<void> {
	const entry = running.value
	if (!entry) return
	const status = await readStatus(entry.jobId).catch(() => null)
	if (!status) return
	if (status.status === EXPORT_STATUS.pending) {
		entry.progress = status.progress
		return
	}
	finished.value = { ...entry, ...status }
	await load()
}

function stopPolling(): void {
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = null
}

/** One timer at most, following the export being built, if any. */
function syncPolling(): void {
	stopPolling()
	if (running.value) pollTimer = setInterval(pollRunning, POLL_INTERVAL_MS)
}

watch(() => running.value?.jobId, syncPolling)

async function clearDeliveredLink(): Promise<void> {
	const { [EXPORT_JOB_QUERY_PARAM]: _consumed, ...query } = route.query
	await router.replace({ query })
}

/**
 * The link mailed on completion lands here carrying its job id: the archive
 * sits behind an authenticated route, so the page downloads it for the
 * visitor. The parameter is dropped once the download succeeded or the
 * archive is gone for good, and kept on a transient failure so a reload
 * tries again.
 */
async function consumeDeliveredLink(): Promise<void> {
	const jobId = route.query[EXPORT_JOB_QUERY_PARAM]
	if (typeof jobId !== 'string' || !jobId) return
	const entry = state.value.entries.find((item) => item.jobId === jobId)
	try {
		await download(jobId, entry)
		await clearDeliveredLink()
	} catch (error) {
		const isGone = GONE_STATUSES.has(errorStatus(error) ?? 0)
		if (!isGone) return notifyError(error, `${KEYS}.error.download`)
		expiredLinkJobId.value = jobId
		await clearDeliveredLink()
	}
}

onMounted(async () => {
	await refresh()
	syncPolling()
	await consumeDeliveredLink()
})

onBeforeUnmount(stopPolling)
</script>

<template>
	<div class="flex flex-col gap-4">
		<DmsBanner
			v-if="expiredLinkJobId"
			tone="warning"
			icon="i-ph-link-break"
			:title="$t(`${KEYS}.expired_link.title`)"
			:description="$t(`${KEYS}.expired_link.description`)"
		>
			<template #actions>
				<UButton
					color="neutral"
					variant="outline"
					size="sm"
					:loading="state.isStarting"
					:disabled="!!running"
					@click="requestExport"
				>
					{{ $t(`${KEYS}.expired_link.action`) }}
				</UButton>
			</template>
		</DmsBanner>

		<DmsCard>
			<div class="flex flex-col gap-3">
				<DmsStatusPill
					tone="info"
					icon="i-ph-scales"
					:label="$t(`${KEYS}.gdpr`)"
					class="self-start"
				/>
				<p class="text-muted text-sm">
					{{ $t(`${KEYS}.intro`, { email }) }}
				</p>
				<div class="flex flex-wrap items-center gap-3">
					<UButton
						color="primary"
						icon="i-ph-download-simple"
						:loading="state.isStarting"
						:disabled="!!running"
						@click="requestExport"
					>
						{{ $t(`${KEYS}.request`) }}
					</UButton>
					<span v-if="running" class="text-muted text-xs">
						{{ $t(`${KEYS}.request_unavailable`) }}
					</span>
				</div>
			</div>
		</DmsCard>

		<DmsCard v-if="running" :title="$t(`${KEYS}.in_progress.title`)">
			<div class="flex flex-col gap-2" aria-live="polite">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-highlighted text-sm font-medium">
						{{ $t(`${KEYS}.scope`) }}
					</span>
					<DmsStatusPill
						tone="info"
						dot="live"
						:label="$t(`${KEYS}.history.status.pending`)"
					/>
				</div>
				<p class="text-muted text-xs">
					{{
						$t(`${KEYS}.in_progress.requested`, {
							time: formatTime(running.createdAt),
							day: formatDay(running.createdAt),
						})
					}}
				</p>
				<div class="flex items-center gap-3">
					<UProgress :model-value="progress" class="grow" />
					<span class="text-muted font-mono text-xs tabular-nums">
						{{ progress }}%
					</span>
				</div>
			</div>
		</DmsCard>

		<DmsBanner
			v-else-if="finished"
			:tone="finished.status === EXPORT_STATUS.failed ? 'error' : 'success'"
			:icon="
				finished.status === EXPORT_STATUS.failed
					? 'i-ph-warning-circle'
					: 'i-ph-check-circle'
			"
			:title="
				finished.status === EXPORT_STATUS.failed
					? $t(`${KEYS}.finished.failed_title`)
					: $t(`${KEYS}.finished.title`)
			"
			:description="
				finished.status === EXPORT_STATUS.failed
					? $t(`${KEYS}.finished.failed_description`)
					: $t(
							isFinishedPartial
								? `${KEYS}.finished.partial_description`
								: `${KEYS}.finished.description`,
							{ email, date: formatDay(finished.expiresAt) },
						)
			"
		>
			<template #actions>
				<UButton
					v-if="finished.status === EXPORT_STATUS.failed"
					color="neutral"
					variant="outline"
					size="sm"
					icon="i-ph-arrow-clockwise"
					:loading="state.isStarting"
					@click="requestExport"
				>
					{{ $t(`${KEYS}.history.retry`) }}
				</UButton>
				<UButton
					v-else
					color="primary"
					size="sm"
					icon="i-ph-download-simple"
					:loading="isDownloading"
					@click="downloadFinished"
				>
					{{ $t(`${KEYS}.history.download`) }}
				</UButton>
			</template>
		</DmsBanner>
	</div>
</template>
