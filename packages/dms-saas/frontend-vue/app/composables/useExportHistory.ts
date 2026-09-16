import { ref } from "vue";

const HISTORY_ENDPOINT = "/api/saas/data-export/history";
const HISTORY_PAGE_SIZE = 10;
const FIRST_PAGE = 1;
const DOWNLOAD_ENDPOINT = "/api/saas/data-export/download";
const FILENAME_HEADER_PATTERN = /filename="([^"]+)"/i;
const FALLBACK_EXTENSION = "zip";

export interface ExportJobFailure {
  source: string;
  error: string;
}

export interface ExportJobResult {
  partial: boolean;
  failures: ExportJobFailure[];
}

export interface ExportHistoryEntry {
  jobId: string;
  scope: string;
  status: string;
  progress: number;
  error?: string;
  filename?: string;
  extension?: string;
  result?: ExportJobResult;
  /** Moment the stale export sweep drops the archive and its download link. */
  expiresAt?: string;
  createdAt: string;
}

function parseFilename(header: string | null): string | null {
  return header?.match(FILENAME_HEADER_PATTERN)?.[1] ?? null;
}

export interface ExportHistoryPage {
  items: ExportHistoryEntry[];
  hasMore: boolean;
  page: number;
  pageSize: number;
}

export interface ExportDownloadNaming {
  filename?: string;
  extension?: string;
}

function fallbackFilename(jobId: string, naming?: ExportDownloadNaming): string {
  const extension = naming?.extension ?? FALLBACK_EXTENSION;
  return `${naming?.filename ?? `export-${jobId}`}.${extension}`;
}

/**
 * The caller's past exports for the current workspace, and the download of a
 * single one of them — the action both the history rows and the e-mailed link
 * land on.
 */
export function useExportHistory() {
  const { $authFetch } = useAuthFetch();

  const entries = ref<ExportHistoryEntry[]>([]);
  const isLoading = ref(false);
  const hasFailed = ref(false);
  const page = ref(FIRST_PAGE);
  const hasMore = ref(false);

  /**
   * Defaults back to the first page: every caller that reloads does so because
   * the list changed at its most recent end, which is where page one is.
   *
   * A page past the first that comes back empty falls back to the first rather
   * than showing the "no export yet" state, which would be a lie — exports
   * expiring under the reader is enough to empty the page they were on.
   */
  async function load(targetPage: number = FIRST_PAGE): Promise<void> {
    isLoading.value = true;
    try {
      const result = await $authFetch<ExportHistoryPage>(HISTORY_ENDPOINT, {
        query: { page: targetPage, pageSize: HISTORY_PAGE_SIZE },
      });
      if (!result.items.length && result.page > FIRST_PAGE) {
        isLoading.value = false;
        return load(FIRST_PAGE);
      }
      entries.value = result.items;
      page.value = result.page;
      hasMore.value = result.hasMore;
      hasFailed.value = false;
    } catch {
      hasFailed.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  function goToPage(targetPage: number): Promise<void> {
    if (targetPage < FIRST_PAGE || isLoading.value) return Promise.resolve();
    return load(targetPage);
  }

  /**
   * Takes a job id rather than a history row: a link delivered by e-mail may
   * point at an export older than the window the history lists, and refusing
   * to download it because it is not on screen would be a lie the server never
   * told.
   */
  async function download(
    jobId: string,
    naming?: ExportDownloadNaming,
  ): Promise<void> {
    // Encoded because a delivered link hands its job id straight over: an id
    // holding a separator would otherwise address a different route.
    const response = await $authFetch.raw(
      `${DOWNLOAD_ENDPOINT}/${encodeURIComponent(jobId)}`,
      { responseType: "blob" },
    );
    const blob = response._data as Blob | null;
    if (!blob) throw new Error("Empty export download");

    const objectUrl = URL.createObjectURL(blob);
    try {
      const filename =
        parseFilename(response.headers.get("content-disposition")) ??
        fallbackFilename(jobId, naming);
      downloadFile(objectUrl, filename);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return {
    entries,
    isLoading,
    hasFailed,
    page,
    hasMore,
    load,
    goToPage,
    download,
  };
}
