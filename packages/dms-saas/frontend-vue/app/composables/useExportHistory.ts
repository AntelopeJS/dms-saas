import { computed, type ComputedRef } from 'vue'

const EXPORT_ENDPOINT = '/api/saas/data-export'
const HISTORY_ENDPOINT = `${EXPORT_ENDPOINT}/history`
const START_ENDPOINT = `${EXPORT_ENDPOINT}/start`
const STATUS_ENDPOINT = `${EXPORT_ENDPOINT}/status`
const DOWNLOAD_ENDPOINT = `${EXPORT_ENDPOINT}/download`
const HISTORY_PAGE_SIZE = 10
const FIRST_PAGE = 1
const STATE_KEY = 'saas-export-history'
const FILENAME_HEADER_PATTERN = /filename="([^"]+)"/i
const FALLBACK_EXTENSION = 'zip'

/** `ExportStatus` of the DMS export engine. */
export const EXPORT_STATUS = {
	pending: 'pending',
	completed: 'completed',
	failed: 'failed',
} as const

export interface ExportJobFailure {
	source: string
	error: string
}

export interface ExportJobResult {
	partial: boolean
	failures: ExportJobFailure[]
}

export interface ExportHistoryEntry {
	jobId: string
	scope: string
	status: string
	progress: number
	error?: string
	filename?: string
	extension?: string
	result?: ExportJobResult
	/** Moment the stale export sweep drops the archive and its download link. */
	expiresAt?: string
	createdAt: string
}

export interface ExportHistoryPage {
	items: ExportHistoryEntry[]
	hasMore: boolean
	page: number
	pageSize: number
}

export interface ExportDownloadNaming {
	filename?: string
	extension?: string
}

type ExportJobStatus = Omit<ExportHistoryEntry, 'jobId' | 'scope' | 'createdAt'>

interface ExportHistoryState {
	entries: ExportHistoryEntry[]
	isLoading: boolean
	hasLoaded: boolean
	hasFailed: boolean
	isStarting: boolean
	page: number
	hasMore: boolean
}

function initialState(): ExportHistoryState {
	return {
		entries: [],
		isLoading: false,
		hasLoaded: false,
		hasFailed: false,
		isStarting: false,
		page: FIRST_PAGE,
		hasMore: false,
	}
}

function parseFilename(header: string | null): string | null {
	return header?.match(FILENAME_HEADER_PATTERN)?.[1] ?? null
}

function fallbackFilename(
	jobId: string,
	naming?: ExportDownloadNaming,
): string {
	const extension = naming?.extension ?? FALLBACK_EXTENSION
	return `${naming?.filename ?? `export-${jobId}`}.${extension}`
}

/** Whether an entry's archive can still be downloaded. */
export function isExportExpired(
	entry: ExportHistoryEntry,
	nowMs: number,
): boolean {
	return !!entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs
}

/** The history reload both blocks of the page share while it runs. */
let pendingRefresh: Promise<void> | null = null

interface ExportHistoryHandle {
	state: Ref<ExportHistoryState>
	/** The export still being built, if the newest page holds one. */
	running: ComputedRef<ExportHistoryEntry | null>
	load: (targetPage?: number) => Promise<void>
	refresh: () => Promise<void>
	goToPage: (targetPage: number) => Promise<void>
	start: () => Promise<void>
	readStatus: (jobId: string) => Promise<ExportJobStatus>
	download: (jobId: string, naming?: ExportDownloadNaming) => Promise<void>
}

/**
 * The caller's exports of the current workspace, shared by the request card
 * and the history list of the Data export page: one export runs at a time, so
 * both read the same running entry.
 */
export function useExportHistory(): ExportHistoryHandle {
	const { $authFetch } = useAuthFetch()
	const state = useDmsState<ExportHistoryState>(STATE_KEY, initialState)

	const running = computed(
		() =>
			state.value.entries.find(
				(entry) => entry.status === EXPORT_STATUS.pending,
			) ?? null,
	)

	/**
	 * A page past the first that comes back empty falls back to the first
	 * rather than showing the "no export yet" state, which would be a lie —
	 * exports expiring under the reader is enough to empty the page they were on.
	 */
	async function load(targetPage: number = FIRST_PAGE): Promise<void> {
		state.value.isLoading = true
		try {
			const result = await $authFetch<ExportHistoryPage>(HISTORY_ENDPOINT, {
				query: { page: targetPage, pageSize: HISTORY_PAGE_SIZE },
			})
			if (!result.items.length && result.page > FIRST_PAGE) {
				return await load(FIRST_PAGE)
			}
			Object.assign(state.value, {
				entries: result.items,
				page: result.page,
				hasMore: result.hasMore,
				hasFailed: false,
				hasLoaded: true,
			})
		} catch {
			state.value.hasFailed = true
		} finally {
			state.value.isLoading = false
		}
	}

	/**
	 * Reloads the newest page once for every block mounting together: the
	 * request card and the history are granted apart, so each one loads, but
	 * a page showing both reads the history a single time.
	 */
	function refresh(): Promise<void> {
		pendingRefresh ??= load().finally(() => {
			pendingRefresh = null
		})
		return pendingRefresh
	}

	function goToPage(targetPage: number): Promise<void> {
		if (targetPage < FIRST_PAGE || state.value.isLoading)
			return Promise.resolve()
		return load(targetPage)
	}

	/** Rejects with the server's refusal, for the caller to word. */
	async function start(): Promise<void> {
		if (state.value.isStarting) return
		state.value.isStarting = true
		try {
			await $authFetch(START_ENDPOINT, { method: 'POST' })
		} finally {
			state.value.isStarting = false
			await load()
		}
	}

	function readStatus(jobId: string): Promise<ExportJobStatus> {
		return $authFetch<ExportJobStatus>(
			`${STATUS_ENDPOINT}/${encodeURIComponent(jobId)}`,
		)
	}

	/**
	 * Takes a job id rather than a history row: a link delivered by e-mail may
	 * point at an export older than the window the history lists. The id is
	 * encoded because a delivered link hands it straight over.
	 */
	async function download(
		jobId: string,
		naming?: ExportDownloadNaming,
	): Promise<void> {
		const response = await $authFetch.raw(
			`${DOWNLOAD_ENDPOINT}/${encodeURIComponent(jobId)}`,
			{ responseType: 'blob' },
		)
		const blob = response._data as Blob | null
		if (!blob) throw new Error('Empty export download')
		const objectUrl = URL.createObjectURL(blob)
		try {
			const filename =
				parseFilename(response.headers.get('content-disposition')) ??
				fallbackFilename(jobId, naming)
			downloadFile(objectUrl, filename)
		} finally {
			URL.revokeObjectURL(objectUrl)
		}
	}

	return {
		state,
		running,
		load,
		refresh,
		goToPage,
		start,
		readStatus,
		download,
	}
}
