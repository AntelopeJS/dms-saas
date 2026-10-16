import { computed, ref, type ComputedRef } from 'vue'

const EXPORT_ENDPOINT = '/api/saas/data-export'
const HISTORY_ENDPOINT = `${EXPORT_ENDPOINT}/history`
const START_ENDPOINT = `${EXPORT_ENDPOINT}/start`
/** Where an export's progress is read, by job id. */
export const EXPORT_STATUS_ENDPOINT = `${EXPORT_ENDPOINT}/status`
const DOWNLOAD_ENDPOINT = `${EXPORT_ENDPOINT}/download`
const HISTORY_PAGE_SIZE = 10
const FIRST_PAGE = 1
const HISTORY_KEY = 'saas-export-history'
const STARTING_STATE_KEY = 'saas-export-starting'
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

export type ExportJobStatus = Omit<ExportHistoryEntry, 'jobId' | 'scope' | 'createdAt'>

interface ExportHistoryState {
	entries: ExportHistoryEntry[]
	isLoading: boolean
	hasLoaded: boolean
	hasFailed: boolean
	isStarting: boolean
	page: number
	hasMore: boolean
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

interface ExportHistoryHandle {
	/** The page of the history this block shows, read with the page. */
	state: ComputedRef<ExportHistoryState>
	/** The export still being built, if the newest page holds one. */
	running: ComputedRef<ExportHistoryEntry | null>
	/** Reads the newest page again, and the page shown. */
	load: () => Promise<void>
	goToPage: (targetPage: number) => void
	start: () => Promise<void>
	download: (jobId: string, naming?: ExportDownloadNaming) => Promise<void>
}

/**
 * The caller's exports of the current workspace, shared by the request card
 * and the history list of the Data export page: one export runs at a time, so
 * both read the same running entry, from the newest page. The history list
 * pages through the rest; the request card stays on the newest page.
 */
export function useExportHistory(): ExportHistoryHandle {
	const { $authFetch } = useAuthFetch()
	const isStarting = useDmsState<boolean>(STARTING_STATE_KEY, () => false)
	const page = ref(FIRST_PAGE)

	/**
	 * A page past the first that comes back empty falls back to the first
	 * rather than showing the "no export yet" state, which would be a lie —
	 * exports expiring under the reader is enough to empty the page they were on.
	 */
	function readPage(target: () => number) {
		return useApiData<ExportHistoryPage>(
			() => `${HISTORY_KEY}:${target()}`,
			async ({ $authFetch: fetch, signal }) => {
				const read = (pageNumber: number) =>
					fetch<ExportHistoryPage>(HISTORY_ENDPOINT, {
						query: { page: pageNumber, pageSize: HISTORY_PAGE_SIZE },
						signal,
					})
				const result = await read(target())
				return !result.items.length && result.page > FIRST_PAGE
					? read(FIRST_PAGE)
					: result
			},
		)
	}

	const newest = readPage(() => FIRST_PAGE)
	const shown = readPage(() => page.value)

	const running = computed(
		() =>
			newest.data.value?.items.find(
				(entry) => entry.status === EXPORT_STATUS.pending,
			) ?? null,
	)

	const state = computed<ExportHistoryState>(() => {
		const current = shown.data.value
		return {
			entries: current?.items ?? [],
			isLoading: shown.pending.value,
			hasLoaded: !!current,
			hasFailed: shown.status.value === 'error',
			isStarting: isStarting.value,
			page: current?.page ?? page.value,
			hasMore: current?.hasMore ?? false,
		}
	})

	async function load(): Promise<void> {
		await Promise.all(
			page.value === FIRST_PAGE
				? [newest.refresh()]
				: [newest.refresh(), shown.refresh()],
		)
	}

	function goToPage(targetPage: number): void {
		if (targetPage < FIRST_PAGE || shown.pending.value) return
		page.value = targetPage
	}

	/** Rejects with the server's refusal, for the caller to word. */
	async function start(): Promise<void> {
		if (isStarting.value) return
		isStarting.value = true
		try {
			await $authFetch(START_ENDPOINT, { method: 'POST' })
		} finally {
			page.value = FIRST_PAGE
			// The new export is listed before the button comes back.
			await refreshPageBlocks()
			isStarting.value = false
		}
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
		// A file to save, not data to show: fetched as it is, never kept.
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
		goToPage,
		start,
		download,
	}
}
