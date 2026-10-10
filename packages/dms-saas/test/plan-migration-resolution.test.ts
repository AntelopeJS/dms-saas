import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
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
import type { PlanMigration } from "../src/db";
import {
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../src/db";
import {
  migrationAbilities,
  migrationTotals,
} from "../src/plans/migration-detail";
import {
  processPlanMigrationJob,
  reconcileMigration,
  resolveUncertainWorkspace,
  retryFailedPlanMigrationWorkspaces,
  settledMigrationStatus,
} from "../src/workers";

vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<void>,
  ) => work(),
}));
vi.mock("../src/plans", () => ({
  countOccupiedSeats: async () => 2,
  syncStripeSeatQuantity: async () => undefined,
}));

const SETUP_TIMEOUT_MS = 60_000;
const OPERATOR = "operator";
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({
    url: mongodb.getUri(),
    database: "saas-migration-resolution",
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

/** A Stripe refusal as stripe-node raises it for a declined card. */
function declinedCard(): Error {
  return Object.assign(new Error("Your card was declined."), {
    type: "StripeCardError",
  });
}

async function createJob(): Promise<PlanMigration> {
  const fromPlanId = randomUUID();
  const toPlanId = randomUUID();
  await GetModel(PlanModel).insert(
    [fromPlanId, toPlanId].map((_id) => ({
      _id,
      name: _id === fromPlanId ? "Starter" : "Team",
      isActive: true,
      isDeleted: false,
      billingMode: "flat",
      permissions: ["read"],
      paymentProviderRefs: {},
    })),
  );
  const model = GetModel(PlanMigrationModel);
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

/** Makes the next move of the tenant fail inside its admitted transition. */
function failNextMove(tenantId: string, error: Error): void {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  vi.spyOn(model, "updateDuringTransition").mockRejectedValueOnce(error);
}

async function load(id: string): Promise<PlanMigration> {
  const job = await GetModel(PlanMigrationModel).get(id);
  if (!job) throw new Error("Missing migration");
  return job;
}

async function subscriptionOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).findOne();
}

async function refusal(operation: () => Promise<unknown>): Promise<HTTPResult> {
  const error = await operation().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPResult);
  return error as HTTPResult;
}

describe("settled migration status", () => {
  it.each([
    [["succeeded"], "completed"],
    [["succeeded", "kept"], "partially_failed"],
    [["succeeded", "failed", "kept"], "failed"],
    [["failed", "reconciliation_required"], "reconciliation_required"],
    [["running"], "reconciliation_required"],
  ] as const)("reads %o as %s", (statuses, expected) => {
    expect(
      settledMigrationStatus(
        statuses.map((status) => ({
          tenantId: randomUUID(),
          status,
          error: null,
          seatQuantity: null,
        })),
      ),
    ).toBe(expected);
  });
});

describe("plan migration resolution on the production Mongo provider", () => {
  it("keeps the stage of a migration in line with its status", async () => {
    const job = await createJob();
    expect(job.stage).toBe("running");
    await processPlanMigrationJob(job._id);
    expect(await load(job._id)).toMatchObject({
      status: "completed",
      stage: "done",
    });
  });

  it("marks a declined move as failed, releases it and retries it under a new operation", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    failNextMove(tenantId, declinedCard());
    await processPlanMigrationJob(job._id);

    const failed = await load(job._id);
    expect(failed).toMatchObject({
      status: "failed",
      stage: "needs_attention",
      tenantOutcomes: [
        expect.objectContaining({ status: "failed", attempt: 1 }),
      ],
    });
    expect(await subscriptionOf(tenantId)).toMatchObject({
      planId: job.fromPlanId,
      domainTransition: null,
    });
    expect(migrationAbilities(failed, migrationTotals(failed))).toEqual({
      canResolve: false,
      canRetry: true,
      canReconcile: true,
    });

    await retryFailedPlanMigrationWorkspaces(job._id);
    expect(await load(job._id)).toMatchObject({
      status: "completed",
      processedWorkspaces: 1,
      tenantOutcomes: [
        expect.objectContaining({ status: "succeeded", attempt: 2 }),
      ],
    });
    expect((await subscriptionOf(tenantId))?.planId).toBe(job.toPlanId);
  });

  it("settles an uncertain move the operator read as moved in Stripe", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    failNextMove(tenantId, new Error("Stripe timed out"));
    await processPlanMigrationJob(job._id);
    expect((await load(job._id)).status).toBe("reconciliation_required");
    expect((await subscriptionOf(tenantId))?.domainTransition).not.toBeNull();

    await resolveUncertainWorkspace({
      migrationId: job._id,
      tenantId,
      resolution: "moved",
      operatorId: OPERATOR,
    });

    expect(await load(job._id)).toMatchObject({
      status: "completed",
      processedTenantIds: [tenantId],
      tenantOutcomes: [
        expect.objectContaining({ status: "succeeded", resolvedBy: OPERATOR }),
      ],
    });
    expect(await subscriptionOf(tenantId)).toMatchObject({
      planId: job.toPlanId,
      domainTransition: null,
    });
  });

  it("refuses to close a migration while a workspace is uncertain", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    failNextMove(tenantId, new Error("Stripe timed out"));
    await processPlanMigrationJob(job._id);

    const error = await refusal(() =>
      reconcileMigration({
        migrationId: job._id,
        operatorId: OPERATOR,
        note: "Stays",
      }),
    );
    expect(error.getStatus()).toBe(409);
    expect((await load(job._id)).reconciledAt).toBeFalsy();
  });

  it("allows a retry of a move Stripe never made, then closes it with a note", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    failNextMove(tenantId, new Error("Stripe timed out"));
    await processPlanMigrationJob(job._id);

    await resolveUncertainWorkspace({
      migrationId: job._id,
      tenantId,
      resolution: "not_moved",
      operatorId: OPERATOR,
    });
    expect(await load(job._id)).toMatchObject({
      status: "failed",
      tenantOutcomes: [expect.objectContaining({ status: "failed" })],
    });
    expect(await subscriptionOf(tenantId)).toMatchObject({
      planId: job.fromPlanId,
      domainTransition: null,
    });

    await reconcileMigration({
      migrationId: job._id,
      operatorId: OPERATOR,
      note: "Asked to stay until November",
    });
    expect(await load(job._id)).toMatchObject({
      status: "partially_failed",
      stage: "done",
      reconciledBy: OPERATOR,
      reconciliationNote: "Asked to stay until November",
      tenantOutcomes: [expect.objectContaining({ status: "kept" })],
    });
  });

  it("refuses to settle a workspace that is not uncertain", async () => {
    const job = await createJob();
    const tenantId = await createSubscription(job.fromPlanId);
    await processPlanMigrationJob(job._id);
    await refusal(() =>
      resolveUncertainWorkspace({
        migrationId: job._id,
        tenantId,
        resolution: "not_moved",
        operatorId: OPERATOR,
      }),
    );
  });
});
