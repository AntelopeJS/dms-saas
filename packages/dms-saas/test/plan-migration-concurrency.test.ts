import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../src/db";
import type { PlanMigration } from "../src/db";
import {
  processPlanMigrationJob,
  resumePendingPlanMigrations,
} from "../src/workers/plan-migration";

vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<void>,
  ) => work(),
}));
vi.mock("../src/plans", () => ({
  countOccupiedSeats: async () => 3,
  syncStripeSeatQuantity: async () => undefined,
}));

const SETUP_TIMEOUT_MS = 60_000;
const OLD_TTL_MS = 15 * 60 * 1000;
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({
    url: mongodb.getUri(),
    database: "saas-migration-concurrency",
  });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, SETUP_TIMEOUT_MS);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});

async function createJob(): Promise<PlanMigration> {
  const model = GetModel(PlanMigrationModel);
  const fromPlanId = randomUUID();
  const toPlanId = randomUUID();
  await GetModel(PlanModel).insert(
    [fromPlanId, toPlanId].map((_id) => ({
      _id,
      name: _id,
      isActive: true,
      isDeleted: false,
      billingMode: "flat",
      permissions: ["read"],
      paymentProviderRefs: {},
    })),
  );
  const [id] = await model.insert({
    fromPlanId,
    toPlanId,
    status: "pending",
    notifyMembers: false,
    totalWorkspaces: 0,
    processedWorkspaces: 0,
    processedTenantIds: [],
    failedWorkspaces: [],
  });
  const job = await model.get(id);
  if (!job) throw new Error("Missing migration fixture");
  return job;
}

async function createSubscription(planId: string): Promise<string> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: randomUUID(),
    planId,
    status: "active",
    stripeSubscriptionId: null,
  });
  return tenantId;
}

describe("migration snapshots on the production Mongo provider", () => {
  it("does not execute after an admitted job loses its acknowledgement", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    const model = GetModel(PlanMigrationModel);
    const begin = model.beginJob.bind(model);
    vi.spyOn(model, "beginJob").mockImplementationOnce(
      async (current, snapshot) => {
        await begin(current, snapshot);
        throw new Error("Migration acknowledgement unknown");
      },
    );
    const subscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
    const admission = vi.spyOn(subscriptionModel, "beginTransition");
    await expect(processPlanMigrationJob(job._id)).rejects.toThrow(
      "acknowledgement unknown",
    );
    await processPlanMigrationJob(job._id);
    expect(admission).not.toHaveBeenCalled();
    await resumePendingPlanMigrations();
    expect((await model.get(job._id))?.status).toBe("reconciliation_required");
    expect((await subscriptionModel.findOne())?.planId).toBe(job.fromPlanId);
  });

  it("keeps the source plan even after an empty snapshot completes", async () => {
    const job = await createJob();
    await processPlanMigrationJob(job._id);
    const persisted = await GetModel(PlanMigrationModel).get(job._id);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.snapshot?.tenantIds).toEqual([]);
    expect(await GetModel(PlanModel).get(job.fromPlanId)).toMatchObject({
      isDeleted: false,
      isActive: true,
    });
  });

  it("excludes tenants arriving after capture and retains the frozen target", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    const model = GetModel(PlanMigrationModel);
    const begin = model.beginJob.bind(model);
    let lateTenant = "";
    vi.spyOn(model, "beginJob").mockImplementationOnce(
      async (current, snapshot) => {
        const applied = await begin(current, snapshot);
        lateTenant = await createSubscription(job.fromPlanId);
        await GetModel(PlanModel).update(job.toPlanId, {
          name: "Changed after capture",
          permissions: ["write"],
        });
        return applied;
      },
    );
    await processPlanMigrationJob(job._id);
    const persisted = await model.get(job._id);
    expect(persisted?.snapshot?.tenantIds).toEqual([tenantId]);
    expect(persisted?.snapshot?.target).toMatchObject({
      name: job.toPlanId,
      permissions: ["read"],
    });
    expect(persisted?.tenantOutcomes).toEqual([
      { tenantId, status: "succeeded", error: null, seatQuantity: 3 },
    ]);
    expect(
      (await GetModel(TenantSubscriptionModel, lateTenant).findOne())?.planId,
    ).toBe(job.fromPlanId);
    expect(
      (await GetModel(TenantSubscriptionModel, tenantId).findOne())
        ?.domainTransition,
    ).toBeNull();
    expect((await GetModel(PlanModel).get(job.fromPlanId))?.isDeleted).toBe(
      false,
    );
  });

  it("retains a tenant after planId changes but progress persistence crashes, without replay", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    const model = GetModel(PlanMigrationModel);
    const checkpoint = model.checkpoint.bind(model);
    vi.spyOn(model, "checkpoint").mockImplementation(async (current, patch) => {
      if (patch.tenantOutcomes?.some((row) => row.status !== "running"))
        throw new Error("Progress storage unavailable");
      return checkpoint(current, patch);
    });
    await expect(processPlanMigrationJob(job._id)).rejects.toThrow(
      "Progress storage unavailable",
    );
    vi.restoreAllMocks();
    const subscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
    expect(await subscriptionModel.findOne()).toMatchObject({
      planId: job.toPlanId,
      domainTransition: { operationId: `migration:${job._id}:${tenantId}` },
    });
    await resumePendingPlanMigrations();
    const persisted = await model.get(job._id);
    expect(persisted?.status).toBe("reconciliation_required");
    expect(persisted?.snapshot?.tenantIds).toEqual([tenantId]);
    expect(persisted?.tenantOutcomes[0].status).toBe("running");
    const replay = vi.spyOn(subscriptionModel, "beginTransition");
    await processPlanMigrationJob(job._id);
    expect(replay).not.toHaveBeenCalled();
    expect(
      (await subscriptionModel.findOne())?.domainTransition,
    ).not.toBeNull();
  });

  it("does not take over a paused worker beyond the former TTL", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    const model = GetModel(TenantSubscriptionModel, tenantId);
    let release = () => {};
    let admitted = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const update = model.updateDuringTransition.bind(model);
    const write = vi
      .spyOn(model, "updateDuringTransition")
      .mockImplementationOnce(async (...args) => {
        admitted();
        await paused;
        await update(...args);
      });
    const execution = processPlanMigrationJob(job._id);
    await ready;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + OLD_TTL_MS * 2);
    await processPlanMigrationJob(job._id);
    expect(write).toHaveBeenCalledTimes(1);
    const current = await model.findOne();
    if (!current) throw new Error("Missing subscription");
    await expect(
      model.beginTransition(current, {
        operationId: randomUUID(),
        kind: "suspend",
        targetPlanId: null,
        requestedAt: new Date(),
      }),
    ).rejects.toThrow("different pending transition");
    release();
    await execution;
  });
});
