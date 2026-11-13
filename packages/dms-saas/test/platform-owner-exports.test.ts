import { PassThrough } from "node:stream";
import { text } from "node:stream/consumers";
import type { HTTPResult, RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import * as exportJobs from "@antelopejs/interface-dms/base/export-jobs";
import { ExportStatus } from "@antelopejs/interface-dms/base/types";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import {
  type PlanMigration,
  PlanMigrationModel,
  PlanModel,
  SegmentModel,
} from "../src/db";
import { SaasPlanMigrationExportController } from "../src/routes/platformOwner/plan-migration-export";
import { SaasSegmentsExportController } from "../src/routes/platformOwner/segments-export";
import {
  createUser,
  dmsImplementation,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMemoryFileStorage } from "./helpers/file-storage";
import { useMongoDatabase } from "./helpers/mongo";
import { httpRefusal } from "./helpers/refusal";

useMongoDatabase();
useDmsAuth();
useMemoryFileStorage();
ImplementInterface(
  exportJobs,
  dmsImplementation("implementations/dms-base/export-jobs.js"),
);

const HTTP_FORBIDDEN = 403;
const OTHER_ID = "another-one";

interface PlatformOwner {
  owner: User;
  request: RequestContext;
}

async function platformOwner(): Promise<PlatformOwner> {
  const owner = await createUser({ owner: true });
  return { owner, request: await tenantRequest(owner, DEFAULT_TENANT_ID) };
}

/** A response that keeps what a download writes to it. */
function downloadResponse() {
  const stream = new PassThrough();
  const response = fromPartial<HTTPResult>({
    addHeader: () => undefined,
    getWriteStream: () => stream,
  });
  return { response, body: text(stream) };
}

/** The four routes of one platform-owner export, keyed by the record it reads. */
interface ExportRoutes {
  start(caller: PlatformOwner, id: string): Promise<{ jobId: string }>;
  status(
    caller: PlatformOwner,
    id: string,
    jobId: string,
  ): Promise<{ status: string }>;
  download(caller: PlatformOwner, id: string, jobId: string): Promise<void>;
}

async function insertMigration(): Promise<string> {
  const [id] = await GetModel(PlanMigrationModel).insert(
    fromPartial<PlanMigration>({
      fromPlanId: "starter",
      toPlanId: "team",
      fromPlanName: "Starter",
      toPlanName: "Team",
      status: "completed",
      initiatedBy: "operator",
      createdAt: new Date(),
      totalWorkspaces: 0,
      snapshot: { tenantIds: [], target: {} },
      tenantOutcomes: [],
    }),
  );
  return id;
}

async function insertSegment(): Promise<string> {
  const [id] = await GetModel(SegmentModel).insert({
    name: "Everyone",
    conditions: { logical: "and", conditions: [] },
    estimatedCount: 0,
    countHistory: [],
    lastEvaluationMs: null,
  });
  return id;
}

const migrationExport: ExportRoutes = {
  start: ({ owner, request }, id) =>
    Object.assign(new SaasPlanMigrationExportController(), {
      planMigrationModel: GetModel(PlanMigrationModel),
    }).startExport(owner, request, id),
  status: ({ owner, request }, id, jobId) =>
    new SaasPlanMigrationExportController().exportStatus(
      owner,
      request,
      id,
      jobId,
    ),
  download: ({ owner, request }, id, jobId) =>
    new SaasPlanMigrationExportController().downloadExport(
      owner,
      request,
      id,
      jobId,
    ),
};

const segmentExport: ExportRoutes = {
  start: ({ owner, request }, id) =>
    Object.assign(new SaasSegmentsExportController(), {
      segmentModel: GetModel(SegmentModel),
      planModel: GetModel(PlanModel),
    }).startOwnersExport(owner, request, id),
  status: ({ owner, request }, id, jobId) =>
    new SaasSegmentsExportController().getOwnersExportStatus(
      owner,
      request,
      id,
      jobId,
    ),
  download: ({ owner, request }, id, jobId) =>
    new SaasSegmentsExportController().downloadOwnersExport(
      owner,
      request,
      id,
      jobId,
    ),
};

describe.each([
  {
    name: "plan migration workspaces",
    routes: migrationExport,
    insert: insertMigration,
    header: "workspace_id",
  },
  {
    name: "segment owners",
    routes: segmentExport,
    insert: insertSegment,
    header: "user_id",
  },
])("the $name export", ({ routes, insert, header }) => {
  it("serves the platform owner the export it started", async () => {
    const caller = await platformOwner();
    const id = await insert();
    const { jobId } = await routes.start(caller, id);

    await vi.waitFor(async () => {
      await expect(routes.status(caller, id, jobId)).resolves.toMatchObject({
        status: ExportStatus.completed,
      });
    });
    const { response, body } = downloadResponse();
    Object.assign(caller.request, { response });
    await routes.download(caller, id, jobId);

    expect(await body).toContain(header);
  });

  it("refuses the job of another record", async () => {
    const caller = await platformOwner();
    const id = await insert();
    const { jobId } = await routes.start(caller, id);

    const status = await httpRefusal(routes.status(caller, OTHER_ID, jobId));
    const download = await httpRefusal(
      routes.download(caller, OTHER_ID, jobId),
    );

    expect([status.status, download.status]).toEqual([
      HTTP_FORBIDDEN,
      HTTP_FORBIDDEN,
    ]);
  });
});
