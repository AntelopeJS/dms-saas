import {
  Context,
  Controller,
  Get,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { ExportStatus } from "@antelopejs/interface-dms/base/types";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  downloadExportJob,
  EMAIL_DELIVERY,
  type ExportJobAccessOptions,
  type ExportJobStatus,
  type ExportJobSummary,
  type ExportJobTicket,
  getExportJobStatus,
  listExportJobs,
  type StartTenantExportJobOptions,
  startTenantExportJob,
} from "@antelopejs/interface-dms/base";
import { DATA_EXPORT_PAGE_PATH } from "../../pages/tenant/data-export";
import {
  type Page,
  type PageLimits,
  parsePositiveInt,
  resolvePageBounds,
  slicePage,
} from "../../utils";

const DATA_EXPORT_SCOPE = "saas-tenant-data-export";
const EXPORT_FILENAME_PREFIX = "workspace-export";

const HISTORY_PAGE_LIMITS: PageLimits = {
  defaultPageSize: 10,
  maxPageSize: 50,
  // Exports expire within a day, so a workspace never accumulates anywhere near
  // this many. It is a ceiling on what one request may read, not a target.
  maxFetchLimit: 500,
};

interface ExportHistoryPage extends Page<ExportJobSummary> {
  page: number;
  pageSize: number;
}

const dataExportAccess: ExportJobAccessOptions = { scope: DATA_EXPORT_SCOPE };

const HTTP_CONFLICT = 409;
/** Only the newest jobs can still be running: they are listed newest first. */
const RUNNING_EXPORT_LOOKUP_LIMIT = 5;
/**
 * A job still pending after this long was orphaned by a restart: it must not
 * keep the owner from ever exporting again.
 */
const STALE_PENDING_EXPORT_MS = 60 * 60 * 1000;

/** Whether a job is an export still being built. */
function isRunning(job: ExportJobSummary, nowMs: number): boolean {
  return (
    job.status === ExportStatus.pending &&
    nowMs - new Date(job.createdAt).getTime() < STALE_PENDING_EXPORT_MS
  );
}

type ExportDeliveryOptions = Pick<
  StartTenantExportJobOptions,
  "delivery" | "deliveryPath"
>;

/**
 * The e-mailed link points back at the export page, which downloads the job it
 * carries. With no path to point at there is nothing to deliver, so the export
 * falls back to the download-only default instead of failing the request.
 */
function resolveDelivery(): ExportDeliveryOptions {
  if (!DATA_EXPORT_PAGE_PATH) return {};
  return { delivery: EMAIL_DELIVERY, deliveryPath: DATA_EXPORT_PAGE_PATH };
}

export class SaasDataExportController extends Controller(
  "/api/saas/data-export",
) {
  /**
   * One export at a time: a second one would rebuild the same archive while
   * the first still runs, and the page disables its button for that reason.
   */
  @Post("/start")
  async start(
    @AuthTenantOwner() user: User,
    @Context() ctx: RequestContext,
  ): Promise<ExportJobTicket> {
    const tenantId = getRequestTenantId(ctx);
    const recent = await listExportJobs(ctx, user, {
      scope: DATA_EXPORT_SCOPE,
      limit: RUNNING_EXPORT_LOOKUP_LIMIT,
    });
    assert(
      !recent.some((job) => isRunning(job, Date.now())),
      HTTP_CONFLICT,
      "saas.errors.data_export.already_running",
    );
    return startTenantExportJob({
      ctx,
      user,
      scope: DATA_EXPORT_SCOPE,
      filename: `${EXPORT_FILENAME_PREFIX}-${tenantId}`,
      ...resolveDelivery(),
    });
  }

  /**
   * The caller's own past exports for this workspace. `listExportJobs` reads
   * the export jobs of the request's workspace and keeps only the ones the
   * caller requested, so the history never crosses a workspace or a user.
   *
   * It takes a row limit and no offset, so a page is cut out of the prefix it
   * returns. Pages stay consistent because that prefix is ordered by creation
   * date descending, and the page size is clamped, so a caller cannot turn the
   * read into an unbounded one.
   */
  @Get("/history")
  async history(
    @AuthTenantOwner() user: User,
    @Context() ctx: RequestContext,
    @Parameter("page", "query") page?: string,
    @Parameter("pageSize", "query") pageSize?: string,
  ): Promise<ExportHistoryPage> {
    const bounds = resolvePageBounds(
      { page: parsePositiveInt(page), pageSize: parsePositiveInt(pageSize) },
      HISTORY_PAGE_LIMITS,
    );
    const jobs = await listExportJobs(ctx, user, {
      scope: DATA_EXPORT_SCOPE,
      limit: bounds.fetchLimit,
    });
    return {
      ...slicePage(jobs, bounds),
      page: bounds.page,
      pageSize: bounds.pageSize,
    };
  }

  @Get("/status/:jobId")
  async status(
    @AuthTenantOwner() user: User,
    @Context() ctx: RequestContext,
    @Parameter("jobId") jobId: string,
  ): Promise<ExportJobStatus> {
    return getExportJobStatus(ctx, user, jobId, dataExportAccess);
  }

  @Get("/download/:jobId")
  async download(
    @AuthTenantOwner() user: User,
    @Context() ctx: RequestContext,
    @Parameter("jobId") jobId: string,
  ): Promise<void> {
    await downloadExportJob(ctx, user, jobId, dataExportAccess);
  }
}
