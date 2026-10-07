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
import { PlanModel, SegmentModel } from "../../db";
import {
  evaluateSegmentGroup,
  loadAllUserProjections,
  type UserProjection,
} from "../../utils";

const HTTP_NOT_FOUND = 404;
const OWNERS_EXPORT_SCOPE = "saas-segment-owners";
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);
const CSV_BOM = "﻿";
const MAX_GENERATE_PROGRESS = 99;
const DONE_PROGRESS = 100;
const MINOR_UNITS_PER_UNIT = 100;
const WORKSPACE_SEPARATOR = "; ";

const CSV_HEADER = [
  "user_id",
  "email",
  "name",
  "language",
  "created_at",
  "is_validated",
  "workspaces",
  "owned_workspaces",
  "owned_mrr",
];

interface OwnersExportContext {
  segmentId: string;
}

function ownersExportAccessForSegment(
  segmentId: string,
): ExportJobAccessOptions<OwnersExportContext> {
  return {
    scope: OWNERS_EXPORT_SCOPE,
    isOwnedBy: (_record, context) => context?.segmentId === segmentId,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvEscape(value: string): string {
  let str = value;
  const first = str.charAt(0);
  if (first && FORMULA_PREFIXES.has(first)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function appendCsvRow(filePath: string, row: string[]): void {
  fs.appendFileSync(filePath, `${row.map(csvEscape).join(",")}\r\n`);
}

/** One CSV row of a matching user: who they are and what they own. */
export function segmentExportRow(projection: UserProjection): string[] {
  const owned = projection.workspaces.filter((workspace) => workspace.isOwner);
  const ownedMrr = owned.reduce((sum, workspace) => sum + workspace.mrr, 0);
  return [
    projection._id,
    projection.email,
    projection.name,
    projection.language,
    new Date(projection.createdAt).toISOString(),
    projection.isValidated ? "true" : "false",
    projection.workspaces.map((w) => w.name).join(WORKSPACE_SEPARATOR),
    owned.map((w) => w.name).join(WORKSPACE_SEPARATOR),
    (ownedMrr / MINOR_UNITS_PER_UNIT).toFixed(2),
  ];
}

@AuthOwnerOnly()
export class SaasSegmentsExportController extends Controller(
  "/api/saas/segments",
) {
  @Model(SegmentModel)
  declare segmentModel: SegmentModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Post("/:id/owners-export/start")
  async startOwnersExport(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
  ) {
    const segment = await this.segmentModel.get(id);
    assert(segment, HTTP_NOT_FOUND, "saas.errors.segments.not_found");
    const planModel = this.planModel;
    const { name, conditions } = segment;

    return runExportJob<OwnersExportContext>({
      ctx,
      user,
      scope: OWNERS_EXPORT_SCOPE,
      context: { segmentId: id },
      filename: `segment-${slugify(name) || id}-users`,
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      generate: async ({ localPath, reportProgress }) => {
        fs.writeFileSync(localPath, CSV_BOM);
        appendCsvRow(localPath, CSV_HEADER);
        const projections = await loadAllUserProjections(planModel);
        const matched = projections
          .filter((projection) => evaluateSegmentGroup(conditions, projection))
          .sort((a, b) => a.email.localeCompare(b.email));
        for (const [index, projection] of matched.entries()) {
          appendCsvRow(localPath, segmentExportRow(projection));
          await reportProgress(
            Math.floor(((index + 1) / matched.length) * MAX_GENERATE_PROGRESS),
          );
        }
        if (matched.length === 0) await reportProgress(DONE_PROGRESS);
      },
    });
  }

  @Get("/:id/owners-export/status/:jobId")
  async getOwnersExportStatus(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
    @Parameter("jobId") jobId: string,
  ): Promise<ExportJobStatus> {
    return getExportJobStatus(
      ctx,
      user,
      jobId,
      ownersExportAccessForSegment(id),
    );
  }

  @Get("/:id/owners-export/download/:jobId")
  async downloadOwnersExport(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
    @Parameter("jobId") jobId: string,
  ): Promise<void> {
    await downloadExportJob(ctx, user, jobId, ownersExportAccessForSegment(id));
  }
}
