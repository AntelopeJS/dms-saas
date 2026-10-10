import fs from "node:fs";
import {
  Context,
  Controller,
  Get,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  downloadExportJob,
  type ExportJobAccessOptions,
  type ExportJobStatus,
  getExportJobStatus,
  runExportJob,
} from "@antelopejs/interface-dms/base";
import { PlanMigrationModel } from "../../db";
import {
  WORKSPACE_EXPORT_HEADER,
  workspaceExportRow,
} from "../../plans/migration-workspaces";
import { CSV_BOM, appendCsvRow } from "../../utils/csv-file";
import {
  loadMigrationContext,
  loadWorkspaceRows,
} from "./plan-migration-context";

const HTTP_NOT_FOUND = 404;
const EXPORT_SCOPE = "saas-plan-migration-workspaces";
const DONE_PROGRESS = 100;

interface MigrationExportContext {
  migrationId: string;
}

function exportAccess(
  migrationId: string,
): ExportJobAccessOptions<MigrationExportContext> {
  return {
    scope: EXPORT_SCOPE,
    isOwnedBy: (_record, context) => context?.migrationId === migrationId,
  };
}

/** The captured workspaces of a migration as a CSV file. */
export class SaasPlanMigrationExportController extends Controller(
  "/api/saas/plan-migrations",
) {
  @Model(PlanMigrationModel)
  declare planMigrationModel: PlanMigrationModel;

  @Post("/:id/workspaces-export/start")
  async startExport(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
  ) {
    const migration = await this.planMigrationModel.get(id);
    assert(migration, HTTP_NOT_FOUND, "saas.errors.migration.not_found");
    return runExportJob<MigrationExportContext>({
      ctx,
      user,
      scope: EXPORT_SCOPE,
      context: { migrationId: id },
      filename: `plan-migration-${id}-workspaces`,
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      generate: async ({ localPath, reportProgress }) => {
        const context = await loadMigrationContext(migration);
        const rows = await loadWorkspaceRows(context);
        fs.writeFileSync(localPath, CSV_BOM);
        appendCsvRow(localPath, WORKSPACE_EXPORT_HEADER);
        for (const row of rows)
          appendCsvRow(localPath, workspaceExportRow(row));
        await reportProgress(DONE_PROGRESS);
      },
    });
  }

  @Get("/:id/workspaces-export/status/:jobId")
  async exportStatus(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
    @Parameter("jobId") jobId: string,
  ): Promise<ExportJobStatus> {
    return getExportJobStatus(ctx, user, jobId, exportAccess(id));
  }

  @Get("/:id/workspaces-export/download/:jobId")
  async downloadExport(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
    @Parameter("jobId") jobId: string,
  ): Promise<void> {
    await downloadExportJob(ctx, user, jobId, exportAccess(id));
  }
}
