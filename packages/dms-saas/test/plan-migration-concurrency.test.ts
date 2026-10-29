import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../src/db";
import { planRow } from "./helpers/plan-row";
import type { PlanMigration, TenantSubscription } from "../src/db";
import {
  processPlanMigrationJob,
  resumePendingPlanMigrations,
} from "../src/workers/plan-migration";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { seatMembers } from "./helpers/workspaces";

useMongoDatabase("plan-migration-concurrency");
const stripe = useSuiteStripe();

const SCHEDULED_AT = new Date("2026-11-01T00:00:00.000Z");
const OLD_TTL_MS = 15 * 60 * 1000;
/** The seats each migrated workspace occupies. */
const SEATS = 3;

/**
 * Stripe's side of a workspace scheduled to switch plans: no schedule left
 * attached, and an end-of-period cancellation that ends at {@link SCHEDULED_AT}.
 */
function stubScheduledSubscription() {
  return {
    retrieve: vi
      .spyOn(stripe.write.subscriptions, "retrieve")
      .mockResolvedValue(
        fromPartial({ schedule: null, cancel_at_period_end: false }),
      ),
    update: vi.spyOn(stripe.write.subscriptions, "update").mockResolvedValue(
      fromPartial({
        items: {
          data: [{ current_period_end: SCHEDULED_AT.getTime() / 1_000 }],
        },
      }),
    ),
  };
}

afterEach(() => vi.restoreAllMocks());

async function createJob(): Promise<PlanMigration> {
  const model = GetModel(PlanMigrationModel);
  const fromPlanId = randomUUID();
  const toPlanId = randomUUID();
  await GetModel(PlanModel).insert(
    [fromPlanId, toPlanId].map((_id) =>
      planRow({
        _id,
        name: _id,
        isActive: true,
        isDeleted: false,
        billingMode: "flat",
        permissions: ["read"],
        paymentProviderRefs: {},
      }),
    ),
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

async function createSubscription(
  planId: string,
  fields: Partial<TenantSubscription> = {},
): Promise<string> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: randomUUID(),
    planId,
    status: "active",
    stripeSubscriptionId: null,
    ...fields,
  });
  await seatMembers(tenantId, SEATS);
  return tenantId;
}

/** A workspace on its own plan, scheduled to switch to the retired one. */
async function createScheduledChange(
  job: PlanMigration,
  currentPlanId: string = randomUUID(),
): Promise<string> {
  return createSubscription(currentPlanId, {
    stripeSubscriptionId: "sub_scheduled",
    pendingPlanId: job.fromPlanId,
    pendingPlanChangeAt: new Date("2026-10-31T00:00:00.000Z"),
  });
}

describe("retiring a plan scheduled changes switch to", () => {
  let scheduled: ReturnType<typeof stubScheduledSubscription>;

  beforeEach(() => {
    scheduled = stubScheduledSubscription();
  });

  it("redirects the scheduled change to the target plan", async () => {
    const job = await createJob();
    const tenantId = await createScheduledChange(job);

    await processPlanMigrationJob(job._id);

    const persisted = await GetModel(PlanMigrationModel).get(job._id);
    expect(persisted?.snapshot?.tenantIds).toEqual([tenantId]);
    expect(persisted?.tenantOutcomes).toEqual([
      expect.objectContaining({ tenantId, status: "succeeded" }),
    ]);
    expect(scheduled.retrieve).toHaveBeenCalledWith("sub_scheduled");
    // The target has no Stripe price: the change lands as a cancellation at
    // the period end, as any deferred change to such a plan does.
    expect(scheduled.update).toHaveBeenCalledWith("sub_scheduled", {
      cancel_at_period_end: true,
    });
    const subscription = await GetModel(
      TenantSubscriptionModel,
      tenantId,
    ).findOne();
    expect(subscription).toMatchObject({
      pendingPlanId: job.toPlanId,
      pendingPlanChangeAt: SCHEDULED_AT,
      domainTransition: null,
    });
    expect(subscription?.planId).not.toBe(job.toPlanId);
  });

  it("drops a scheduled change that would land on the plan in force", async () => {
    const job = await createJob();
    const tenantId = await createScheduledChange(job, job.toPlanId);

    await processPlanMigrationJob(job._id);

    expect(
      await GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).toMatchObject({
      planId: job.toPlanId,
      pendingPlanId: null,
      pendingPlanChangeAt: null,
    });
    expect(scheduled.update).not.toHaveBeenCalled();
  });
});

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
        await GetModel(PlanModel).update(
          job.toPlanId,
          planRow({ name: "Changed after capture", permissions: ["write"] }),
        );
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
      expect.objectContaining({
        tenantId,
        status: "succeeded",
        error: null,
        seatQuantity: SEATS,
        attempt: 1,
      }),
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

  it("leaves a live executor running when the resume pass is replayed", async () => {
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
    vi.spyOn(model, "updateDuringTransition").mockImplementationOnce(
      async (...args) => {
        admitted();
        await paused;
        await update(...args);
      },
    );
    const execution = processPlanMigrationJob(job._id);
    await ready;
    await resumePendingPlanMigrations();
    await resumePendingPlanMigrations();
    const migrations = GetModel(PlanMigrationModel);
    expect((await migrations.get(job._id))?.status).toBe("running");
    release();
    await execution;
    const persisted = await migrations.get(job._id);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.tenantOutcomes).toEqual([
      expect.objectContaining({
        tenantId,
        status: "succeeded",
        error: null,
        seatQuantity: SEATS,
        attempt: 1,
      }),
    ]);
    expect((await model.findOne())?.planId).toBe(job.toPlanId);
  });
});
