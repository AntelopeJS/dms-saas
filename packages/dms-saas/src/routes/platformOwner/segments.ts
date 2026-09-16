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
  SEGMENT_FIELDS,
  USER_SEGMENT_FIELDS,
} from "../../utils";

const HTTP_NOT_FOUND = 404;
const OWNERS_EXPORT_SCOPE = "saas-segment-owners";
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);
const CSV_BOM = "﻿";
const MAX_GENERATE_PROGRESS = 99;

interface PlanOption {
  _id: string;
  name: string;
}

interface SegmentFieldsCatalog {
  fields: typeof SEGMENT_FIELDS;
  userFields: typeof USER_SEGMENT_FIELDS;
  plans: PlanOption[];
}

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

@AuthOwnerOnly()
export class SaasSegmentsApiController extends Controller(
  "/api/saas/segments",
) {
  @Model(SegmentModel)
  declare segmentModel: SegmentModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/fields")
  async fields(@AuthOwnerOnly() _user: User): Promise<SegmentFieldsCatalog> {
    const plans = await this.planModel.getAll();
    return {
      fields: SEGMENT_FIELDS,
      userFields: USER_SEGMENT_FIELDS,
      plans: plans
        .filter((p) => !p.isDeleted)
        .map((p) => ({ _id: p._id, name: p.name })),
    };
  }

  @Post("/:id/owners-export/start")
  async startOwnersExport(
    @AuthOwnerOnly() user: User,
    @Context() ctx: RequestContext,
    @Parameter("id") id: string,
  ) {
    const segment = await this.segmentModel.get(id);
    assert(segment, HTTP_NOT_FOUND, "saas.errors.segments.not_found");

    const planModel = this.planModel;
    const segmentName = segment.name;
    const segmentConditions = segment.conditions;

    return runExportJob<OwnersExportContext>({
      ctx,
      user,
      scope: OWNERS_EXPORT_SCOPE,
      context: { segmentId: id },
      filename: `segment-${slugify(segmentName) || id}-users`,
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      generate: async ({ localPath, reportProgress }) => {
        fs.writeFileSync(localPath, CSV_BOM);
        appendCsvRow(localPath, [
          "user_id",
          "email",
          "name",
          "language",
          "created_at",
          "is_validated",
          "workspaces_count",
        ]);

        const now = new Date();
        const userProjections = await loadAllUserProjections(planModel, now);
        const matched = userProjections.filter((projection) =>
          evaluateSegmentGroup(segmentConditions, projection),
        );
        matched.sort((a, b) => a.email.localeCompare(b.email));

        if (matched.length === 0) {
          await reportProgress(100);
          return;
        }

        let done = 0;
        for (const projection of matched) {
          appendCsvRow(localPath, [
            projection._id,
            projection.email,
            projection.name,
            projection.language,
            new Date(projection.createdAt).toISOString(),
            projection.isValidated ? "true" : "false",
            String(projection.workspacesCount),
          ]);
          done++;
          await reportProgress(
            Math.floor((done / matched.length) * MAX_GENERATE_PROGRESS),
          );
        }
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
