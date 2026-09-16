<script setup lang="ts">
import { onMounted, ref } from "vue";

const START_ENDPOINT = "/api/saas/data-export/start";
/** Query parameter a delivered export link carries, set by dms-base. */
const EXPORT_JOB_QUERY_PARAM = "exportJob";

const HISTORY_ERROR_DOWNLOAD_KEY =
  "saas.workspace.data_export.history.error_download";
const HISTORY_ERROR_EXPIRED_KEY =
  "saas.workspace.data_export.history.error_expired";

/** Statuses saying the archive is gone for good, not momentarily unreachable. */
const GONE_STATUSES = new Set([404, 410]);

const STATUS_COLORS: Record<string, SemanticColor> = {
  completed: "success",
  failed: "error",
  pending: "info",
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const { runJob } = useExportJob();
const {
  entries,
  isLoading: isHistoryLoading,
  hasFailed,
  page,
  hasMore,
  load,
  goToPage,
  download,
} = useExportHistory();
const { resolveApiError } = useApiErrorMessage();
const { t, locale } = useI18n();
const route = useDmsRoute();
const router = useDmsRouter();
const toast = useToast();

const isStarting = ref(false);
const downloadingJobId = ref<string | null>(null);

function statusColor(entry: ExportHistoryEntry): SemanticColor {
  return STATUS_COLORS[entry.status] ?? "neutral";
}

function statusLabel(entry: ExportHistoryEntry): string {
  if (entry.status === "completed" && entry.result?.partial) {
    return t("saas.workspace.data_export.history.status_partial");
  }
  return t(`saas.workspace.data_export.history.status_${entry.status}`);
}

function formatMoment(value?: string): string {
  return formatDateTime(value, locale.value, DATE_FORMAT) ?? "—";
}

function isExpired(entry: ExportHistoryEntry): boolean {
  return !!entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now();
}

function isDownloadable(entry: ExportHistoryEntry): boolean {
  return entry.status === "completed" && !isExpired(entry);
}

/** One archive at a time, and the other rows say so rather than ignoring a click. */
function isDownloadBlocked(entry: ExportHistoryEntry): boolean {
  return (
    downloadingJobId.value !== null && downloadingJobId.value !== entry.jobId
  );
}

async function startExport(): Promise<void> {
  if (isStarting.value) return;
  isStarting.value = true;
  try {
    await runJob({
      startUrl: START_ENDPOINT,
      startMethod: "POST",
      labels: {
        title: t("saas.workspace.data_export.title"),
        successTitle: t("saas.workspace.data_export.success_title"),
        successMessage: t("saas.workspace.data_export.success_message"),
        errorTitle: t("saas.workspace.data_export.error_title"),
      },
    });
  } finally {
    isStarting.value = false;
    await load();
  }
}

interface DownloadOutcome {
  ok: boolean;
  /** HTTP status of the failure, when the server sent one. */
  status?: number;
}

interface HttpErrorLike {
  statusCode?: unknown;
  status?: unknown;
}

function errorStatus(error: unknown): number | undefined {
  const candidate = error as HttpErrorLike | null;
  const status = candidate?.statusCode ?? candidate?.status;
  return typeof status === "number" ? status : undefined;
}

function isGone(status?: number): boolean {
  return status !== undefined && GONE_STATUSES.has(status);
}

async function runDownload(
  jobId: string,
  errorKey: (status?: number) => string,
  naming?: ExportDownloadNaming,
): Promise<DownloadOutcome> {
  if (downloadingJobId.value) return { ok: false };
  downloadingJobId.value = jobId;
  try {
    await download(jobId, naming);
    return { ok: true };
  } catch (error) {
    const status = errorStatus(error);
    toast.add({
      title: resolveApiError(error, errorKey(status)),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    return { ok: false, status };
  } finally {
    downloadingJobId.value = null;
  }
}

function downloadEntry(entry: ExportHistoryEntry): Promise<DownloadOutcome> {
  return runDownload(entry.jobId, () => HISTORY_ERROR_DOWNLOAD_KEY, entry);
}

/**
 * "Expired" is only claimed when the server said the archive is gone; a
 * network failure or a 500 gets the generic download error instead.
 */
function deliveredLinkErrorKey(status?: number): string {
  return isGone(status)
    ? HISTORY_ERROR_EXPIRED_KEY
    : HISTORY_ERROR_DOWNLOAD_KEY;
}

async function clearDeliveredLink(): Promise<void> {
  const { [EXPORT_JOB_QUERY_PARAM]: _consumed, ...query } = route.query;
  await router.replace({ query });
}

/**
 * The link mailed on completion lands here carrying its job id. The archive is
 * behind an authenticated route, so the page downloads it on the visitor's
 * behalf rather than the link resolving to the file directly.
 *
 * The query parameter is what makes the link retryable: it is dropped once the
 * download succeeded or the archive is gone for good, and kept on a transient
 * failure so reloading the page tries the download again.
 */
async function consumeDeliveredLink(): Promise<void> {
  const jobId = route.query[EXPORT_JOB_QUERY_PARAM];
  if (typeof jobId !== "string" || !jobId) return;

  const outcome = await runDownload(
    jobId,
    deliveredLinkErrorKey,
    entries.value.find((candidate) => candidate.jobId === jobId),
  );
  if (outcome.ok || isGone(outcome.status)) await clearDeliveredLink();
}

onMounted(async () => {
  await load();
  await consumeDeliveredLink();
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        {{ $t("saas.workspace.data_export.intro") }}
      </p>
      <div>
        <UButton
          color="primary"
          icon="i-ph-download-simple"
          :loading="isStarting"
          @click="startExport"
        >
          {{ $t("saas.workspace.data_export.download") }}
        </UButton>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold">
        {{ $t("saas.workspace.data_export.history.title") }}
      </h3>

      <USkeleton v-if="isHistoryLoading" class="h-20 w-full" />

      <UAlert
        v-else-if="hasFailed"
        color="error"
        variant="subtle"
        icon="i-ph-warning-circle"
        :title="$t('saas.workspace.data_export.history.error_load')"
      />

      <p v-else-if="!entries.length" class="text-muted text-sm">
        {{ $t("saas.workspace.data_export.history.empty") }}
      </p>

      <div
        v-else
        class="border-default divide-default divide-y rounded-lg border"
      >
        <div
          v-for="entry in entries"
          :key="entry.jobId"
          class="flex flex-wrap items-center gap-3 p-3 text-sm"
        >
          <div class="min-w-40 grow">
            <p class="tabular-nums">{{ formatMoment(entry.createdAt) }}</p>
            <p class="text-muted text-xs">
              {{ $t("saas.workspace.data_export.history.scope") }}
            </p>
          </div>
          <UBadge :color="statusColor(entry)" variant="subtle" size="sm">
            {{ statusLabel(entry) }}
          </UBadge>
          <span class="text-muted min-w-40 text-xs">
            {{
              isExpired(entry)
                ? $t("saas.workspace.data_export.history.expired")
                : $t("saas.workspace.data_export.history.expires_at", {
                    date: formatMoment(entry.expiresAt),
                  })
            }}
          </span>
          <UButton
            v-if="isDownloadable(entry)"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-ph-download-simple"
            :loading="downloadingJobId === entry.jobId"
            :disabled="isDownloadBlocked(entry)"
            @click="downloadEntry(entry)"
          >
            {{ $t("saas.workspace.data_export.history.download") }}
          </UButton>
        </div>
      </div>

      <div
        v-if="!isHistoryLoading && !hasFailed && (page > 1 || hasMore)"
        class="flex items-center justify-between gap-3"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-ph-caret-left"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          {{ $t("saas.workspace.data_export.history.previous") }}
        </UButton>
        <span class="text-muted text-xs tabular-nums">
          {{ $t("saas.workspace.data_export.history.page", { page }) }}
        </span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-ph-caret-right"
          trailing
          :disabled="!hasMore"
          @click="goToPage(page + 1)"
        >
          {{ $t("saas.workspace.data_export.history.next") }}
        </UButton>
      </div>
    </div>
  </div>
</template>
