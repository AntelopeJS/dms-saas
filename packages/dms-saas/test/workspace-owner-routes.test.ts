import type { RequestContext } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { ExportJobSummary } from "@antelopejs/interface-dms/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../src/db";

interface MemberFake {
  userId: string;
  isTenantOwner: boolean;
}

const store = vi.hoisted(() => ({
  tenantName: "acme",
  renamed: [] as string[],
  deletions: [] as string[],
  exports: [] as ExportJobSummary[],
  started: 0,
  plans: [] as Plan[],
  members: [] as MemberFake[],
  users: new Map<string, { name: string; email: string }>(),
}));

vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "acme",
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: () => ({ get: async (id: string) => store.users.get(id) }),
  };
});

const tenantModel = {
  get: async (id: string) => ({ _id: id, name: store.tenantName }),
  update: async (_id: string, patch: { name: string }) => {
    store.renamed.push(patch.name);
    return 1;
  },
};

const planModel = {
  get: async (id: string) => store.plans.find((plan) => plan._id === id),
  findPubliclyVisible: async () => store.plans,
};

vi.mock("../src/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/workspaces")>()),
  requestWorkspaceDeletion: async (tenantId: string) => {
    store.deletions.push(tenantId);
    return { status: "cancelled", retentionDays: 30 };
  },
}));

vi.mock("@antelopejs/interface-dms/base", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@antelopejs/interface-dms/base")>()),
  listExportJobs: async () => store.exports,
  startTenantExportJob: async () => {
    store.started += 1;
    return { jobId: "job-new", extension: "zip", filename: "export" };
  },
}));

vi.mock("../src/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plans")>()),
  getSeatUsage: async () => ({
    members: 4,
    pendingInvites: 1,
    occupied: 5,
    platformSupport: [],
  }),
}));

const { SaasWorkspacesController } =
  await import("../src/routes/tenant/workspaces");
const { SaasDataExportController } =
  await import("../src/routes/tenant/data-export");
const { SaasTenantSeatsController } =
  await import("../src/routes/tenant/tenant-seats");

// The framework injects the `@Model` fields; a test hands its fakes over.
function workspacesController() {
  return Object.assign(new SaasWorkspacesController(), { tenantModel });
}

function seatsController() {
  return Object.assign(new SaasTenantSeatsController(), { planModel });
}

const owner = { _id: "camille" } as User;
const ctx = {} as RequestContext;
const HOUR_MS = 3_600_000;

function exportJob(status: string, createdAt: Date): ExportJobSummary {
  return {
    jobId: `job-${status}`,
    scope: "saas-tenant-data-export",
    status,
    progress: 10,
    createdAt,
  } as ExportJobSummary;
}

function plan(_id: string, maxMembers: number, order: number): Plan {
  return { _id, name: _id, maxMembers, order } as Plan;
}

beforeEach(() => {
  store.tenantName = "acme";
  store.renamed = [];
  store.deletions = [];
  store.exports = [];
  store.started = 0;
  store.plans = [];
  store.members = [];
  store.users = new Map();
});

describe("workspace rename and deletion", () => {
  it("renames with the trimmed name", async () => {
    const result = await workspacesController().renameCurrent(owner, ctx, {
      name: "  Acme Retail ",
    });

    expect(result).toEqual({ _id: "acme", name: "Acme Retail" });
    expect(store.renamed).toEqual(["Acme Retail"]);
  });

  it("refuses an empty or too long name", async () => {
    const controller = workspacesController();

    await expect(
      controller.renameCurrent(owner, ctx, { name: "  " }),
    ).rejects.toMatchObject({ body: "saas.errors.workspace.name_required" });
    await expect(
      controller.renameCurrent(owner, ctx, { name: "x".repeat(61) }),
    ).rejects.toMatchObject({ body: "saas.errors.workspace.name_too_long" });
    expect(store.renamed).toEqual([]);
  });

  it("deletes only once the typed name matches", async () => {
    const controller = workspacesController();

    await expect(
      controller.deleteCurrent(owner, ctx, { confirmName: "Acme" }),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.workspace.delete_confirmation_mismatch",
    });
    expect(store.deletions).toEqual([]);

    await controller.deleteCurrent(owner, ctx, { confirmName: " acme " });
    expect(store.deletions).toEqual(["acme"]);
  });
});

describe("data export start", () => {
  it("refuses a second export while one is being built", async () => {
    store.exports = [exportJob("pending", new Date())];

    await expect(
      new SaasDataExportController().start(owner, ctx),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.data_export.already_running",
    });
    expect(store.started).toBe(0);
  });

  it("starts once the previous exports are done or orphaned", async () => {
    store.exports = [
      exportJob("completed", new Date()),
      exportJob("pending", new Date(Date.now() - 2 * HOUR_MS)),
    ];

    await expect(
      new SaasDataExportController().start(owner, ctx),
    ).resolves.toMatchObject({ jobId: "job-new" });
    expect(store.started).toBe(1);
  });
});

describe("seat quota", () => {
  function readQuota(planId: string | null) {
    return seatsController().getSeatQuota(
      ctx,
      owner,
      { findOne: async () => ({ planId }) } as never,
      { listAll: async () => store.members } as never,
    );
  }

  beforeEach(() => {
    store.plans = [
      plan("starter", 1, 1),
      plan("pro", 5, 2),
      plan("business", 10, 3),
      plan("enterprise", -1, 4),
    ];
    store.members = [
      { userId: "camille", isTenantOwner: true },
      { userId: "julien", isTenantOwner: false },
    ];
    store.users = new Map([
      ["camille", { name: "Camille Laurent", email: "c@acme.test" }],
    ]);
  });

  it("names the plan, the next plan with more seats and the owners to ask", async () => {
    await expect(readQuota("pro")).resolves.toMatchObject({
      occupied: 5,
      maxMembers: 5,
      planName: "pro",
      upgradePlanName: "business",
      isTenantOwner: true,
      owners: [{ name: "Camille Laurent", email: "c@acme.test" }],
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
