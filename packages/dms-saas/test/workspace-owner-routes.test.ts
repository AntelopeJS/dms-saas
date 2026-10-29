import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ExportJobSummary } from "@antelopejs/interface-dms/base";
import { ExportStatus } from "@antelopejs/interface-dms/base/types";
import * as exportJobs from "@antelopejs/interface-dms/base/export-jobs";
import * as tenantExportArchive from "@antelopejs/interface-dms/base/tenant-export-archive";
import type { RequestContext } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  TenantMemberModel,
  TenantModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { SaasDataExportController } from "../src/routes/tenant/data-export";
import { SaasTenantSeatsController } from "../src/routes/tenant/tenant-seats";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import {
  addTenantMember,
  createUser,
  dmsImplementation,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotifications } from "./helpers/notifications";
import { insertPlan } from "./helpers/plans";
import {
  createOwnedWorkspace,
  insertTenant,
  seatMembers,
} from "./helpers/workspaces";

useMongoDatabase("workspace-owner-routes");
useDmsAuth();
implementNotifications();
const listExportJobs = vi.fn<typeof exportJobs.listExportJobs>();
const startTenantExportJob =
  vi.fn<typeof tenantExportArchive.startTenantExportJob>();
ImplementInterface(exportJobs, {
  ...dmsImplementation("implementations/dms-base/export-jobs.js"),
  listExportJobs,
});
ImplementInterface(tenantExportArchive, {
  ...dmsImplementation("implementations/dms-base/tenant-export-archive.js"),
  startTenantExportJob,
});

function workspacesController() {
  return Object.assign(new SaasWorkspacesController(), {
    tenantModel: GetModel(TenantModel),
  });
}

function seatsController() {
  return Object.assign(new SaasTenantSeatsController(), {
    planModel: GetModel(PlanModel),
  });
}

const HOUR_MS = 3_600_000;

function exportJob(
  status: ExportJobSummary["status"],
  createdAt: Date,
): ExportJobSummary {
  return {
    jobId: `job-${status}`,
    scope: "saas-tenant-data-export",
    status,
    progress: 10,
    createdAt,
  };
}

beforeEach(() => {
  listExportJobs.mockReset();
  startTenantExportJob.mockReset();
});

describe("workspace rename and deletion", () => {
  it("renames with the trimmed name", async () => {
    const { tenantId, owner, request } = await createOwnedWorkspace();

    const result = await workspacesController().renameCurrent(owner, request, {
      name: "  Acme Retail ",
    });

    expect(result).toEqual({ _id: tenantId, name: "Acme Retail" });
    await expect(GetModel(TenantModel).get(tenantId)).resolves.toMatchObject({
      name: "Acme Retail",
    });
  });

  it("refuses an empty or too long name", async () => {
    const { tenantId, owner, request } = await createOwnedWorkspace();
    const controller = workspacesController();

    await expect(
      controller.renameCurrent(owner, request, { name: "  " }),
    ).rejects.toMatchObject({ body: "saas.errors.workspace.name_required" });
    await expect(
      controller.renameCurrent(owner, request, { name: "x".repeat(61) }),
    ).rejects.toMatchObject({ body: "saas.errors.workspace.name_too_long" });
    await expect(GetModel(TenantModel).get(tenantId)).resolves.toMatchObject({
      name: tenantId,
    });
  });

  it("deletes only once the typed name matches", async () => {
    const { tenantId, owner, request } = await createOwnedWorkspace();
    await GetModel(TenantModel).update(tenantId, { name: "acme" });
    await GetModel(TenantSubscriptionModel, tenantId).insert({
      _id: tenantId,
      status: "active",
    });
    const controller = workspacesController();
    const subscription = () =>
      GetModel(TenantSubscriptionModel, tenantId).findOne();

    await expect(
      controller.deleteCurrent(owner, request, { confirmName: "Acme" }),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.workspace.delete_confirmation_mismatch",
    });
    await expect(subscription()).resolves.toMatchObject({ status: "active" });

    await controller.deleteCurrent(owner, request, { confirmName: " acme " });
    await expect(subscription()).resolves.toMatchObject({
      status: "cancelled",
      deletionRequestedBy: owner._id,
    });
  });
});

describe("data export start", () => {
  it("refuses a second export while one is being built", async () => {
    const { owner, request } = await createOwnedWorkspace();
    listExportJobs.mockResolvedValue([
      exportJob(ExportStatus.pending, new Date()),
    ]);

    await expect(
      new SaasDataExportController().start(owner, request),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.data_export.already_running",
    });
    expect(startTenantExportJob).not.toHaveBeenCalled();
  });

  it("starts once the previous exports are done or orphaned", async () => {
    const { tenantId, owner, request } = await createOwnedWorkspace();
    listExportJobs.mockResolvedValue([
      exportJob(ExportStatus.completed, new Date()),
      exportJob(ExportStatus.pending, new Date(Date.now() - 2 * HOUR_MS)),
    ]);
    startTenantExportJob.mockResolvedValue(
      fromPartial({ jobId: "job-new", extension: "zip", filename: "export" }),
    );

    await expect(
      new SaasDataExportController().start(owner, request),
    ).resolves.toMatchObject({ jobId: "job-new" });
    expect(startTenantExportJob).toHaveBeenCalledTimes(1);
    expect(startTenantExportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: request,
        user: owner,
        scope: "saas-tenant-data-export",
        filename: `workspace-export-${tenantId}`,
      }),
    );
  });
});

describe("seat quota", () => {
  let tenantId = "";
  let camille: User;
  let request: RequestContext;

  async function readQuota(planId: string | null) {
    await GetModel(TenantSubscriptionModel, tenantId).update(tenantId, {
      planId,
    });
    return seatsController().getSeatQuota(
      request,
      camille,
      GetModel(TenantSubscriptionModel, tenantId),
      GetModel(TenantMemberModel, tenantId),
    );
  }

  beforeAll(async () => {
    const plans = [
      { _id: "starter", maxMembers: 1, order: 1 },
      { _id: "pro", maxMembers: 5, order: 2 },
      { _id: "business", maxMembers: 10, order: 3 },
      { _id: "enterprise", maxMembers: -1, order: 4 },
    ];
    for (const plan of plans) await insertPlan({ ...plan, isPublic: true });
  });

  beforeEach(async () => {
    tenantId = randomUUID();
    await insertTenant(tenantId);
    camille = await createUser({ name: "Camille Laurent" });
    await addTenantMember(tenantId, camille, true);
    await addTenantMember(tenantId, await createUser());
    await seatMembers(tenantId, 2);
    await GetModel(UserInviteModel, tenantId).insert({
      _id: randomUUID(),
      createdAt: new Date(),
      email: "pending@acme.test",
      roles_ids: [],
      language: "en",
      token: randomUUID(),
      asTenantOwner: false,
      expiresAt: new Date(Date.now() + 24 * HOUR_MS),
    });
    await GetModel(TenantSubscriptionModel, tenantId).insert({
      _id: tenantId,
      status: "active",
    });
    request = await tenantRequest(camille, tenantId);
  });

  it("names the plan, the next plan with more seats and the owners to ask", async () => {
    await expect(readQuota("pro")).resolves.toMatchObject({
      occupied: 5,
      maxMembers: 5,
      planName: "pro",
      upgradePlanName: "business",
      isTenantOwner: true,
      owners: [{ name: "Camille Laurent", email: camille.email }],
    });
  });

  it("announces no ceiling on an unlimited plan or without a plan", async () => {
    await expect(readQuota("enterprise")).resolves.toMatchObject({
      maxMembers: null,
      upgradePlanName: null,
    });
    await expect(readQuota(null)).resolves.toMatchObject({
      maxMembers: null,
      planName: null,
    });
  });
});
