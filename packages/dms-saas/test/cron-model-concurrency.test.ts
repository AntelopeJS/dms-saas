import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { CROSS_INSTANCE, Schema } from "@antelopejs/interface-database";
import {
  GetModel,
  RegisterSchema,
  type DeepPartial,
} from "@antelopejs/interface-database-decorators";
import {
  CORE_SCHEMA_NAME,
  TENANT_SCHEMA_NAME,
} from "@antelopejs/interface-dms/constants";
import {
  type TenantSubscription,
  SegmentModel,
  StripeWebhookEventModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
  UserSegmentModel,
} from "../src/db";

const delivery = vi.hoisted(() => vi.fn());
const deletion = vi.hoisted(() => ({
  schedule: vi.fn(),
  hooks: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  closeTenantLifecycleAdmission: deletion.close,
}));
vi.mock("node-cron", () => ({ default: { schedule: deletion.schedule } }));
vi.mock("../src/workspaces", async () => ({
  ...(await import("../src/workspaces/deletion")),
  resolveDataRetentionDays: async () => 1,
}));
vi.mock("@antelopejs/interface-dms/hooks", async () => ({
  ...(await vi.importActual("@antelopejs/interface-dms/hooks")),
  ExecuteHooks: deletion.hooks,
}));
vi.mock("../src/notifications", async () => ({
  ...(await vi.importActual("../src/notifications")),
  notifyTenantOwners: delivery,
}));
import { deliverSubscriptionCronNotifications } from "../src/crons/subscription-notifications";
import { scheduleHardDeleteCancelled } from "../src/crons/hard-delete-cancelled";

const CUTOFF = new Date("2026-09-14T00:00:00Z");
const BEFORE = new Date("2026-09-13T00:00:00Z");
const CONTENDERS = 12;
let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongo.getUri(), database: "cron-concurrency" });
  await RegisterSchema(CORE_SCHEMA_NAME);
  await RegisterSchema(TENANT_SCHEMA_NAME);
}, 120_000);

afterAll(async () => {
  await destroy();
  await mongo?.stop();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  delivery.mockReset();
  deletion.schedule.mockReset();
  deletion.hooks.mockReset();
  deletion.close.mockReset();
  await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).table.delete().run();
  await GetModel(SegmentModel).table.delete().run();
  await GetModel(UserSegmentModel).table.delete().run();
  await GetModel(TenantBillingStateModel).table.delete().run();
  await GetModel(StripeWebhookEventModel).table.delete().run();
});

async function subscriptionFixture(
  patch: DeepPartial<TenantSubscription> = {},
) {
  const tenantId = randomUUID();
  await Schema.get(TENANT_SCHEMA_NAME)!.createInstance(tenantId).run();
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const [id] = await model.insert({
    status: "active",
    freeUntil: BEFORE,
    stripeSubscriptionId: null,
    deletionStartedAt: null,
    domainTransition: null,
    cronNotification: null,
    ...patch,
  });
  return { tenantId, model, id };
}

async function segmentFixture() {
  const model = GetModel(SegmentModel);
  const [id] = await model.insert({
    name: "Test",
    conditions: { logical: "and", conditions: [] },
    estimatedCount: 0,
  });
  return (await model.get(id))!;
}

describe("subscription cron revision fencing on Mongo", () => {
  it("commits one expiry intent under overlap and replays a failed delivery", async () => {
    const { model, id } = await subscriptionFixture();
    await Promise.all(
      Array.from({ length: CONTENDERS }, () => model.expireFree(id, CUTOFF)),
    );
    const expired = (await model.get(id))!;
    expect(expired.status).toBe("past_due");
    expect(expired.cronNotification).toEqual({
      kind: "free_expired",
      eventId: JSON.stringify(["free_expired", id, BEFORE.toISOString()]),
    });
    delivery.mockRejectedValueOnce(new Error("recipient failed"));
    await deliverSubscriptionCronNotifications("free_expired");
    expect((await model.get(id))?.cronNotification).toEqual(
      expired.cronNotification,
    );
    await deliverSubscriptionCronNotifications("free_expired");
    expect((await model.get(id))?.cronNotification).toBeNull();
    expect(delivery).toHaveBeenCalledTimes(2);
    expect(delivery.mock.calls[1]).toEqual(delivery.mock.calls[0]);
  });

  it("suppresses an obsolete notice after payment rather than notifying an active tenant", async () => {
    const { model, id } = await subscriptionFixture();
    await model.expireFree(id, CUTOFF);
    await model.update(id, { status: "active", stripeSubscriptionId: "paid" });
    await deliverSubscriptionCronNotifications("free_expired");
    expect(delivery).not.toHaveBeenCalled();
    expect((await model.get(id))?.cronNotification).toBeNull();
  });

  it("does not let a failed obsolete expiry notice block suspension", async () => {
    const { model, id } = await subscriptionFixture({
      status: "past_due",
      pastDueSince: BEFORE,
      cronNotification: { kind: "free_expired", eventId: "older-expiry" },
    });
    await model.suspendPastDue(id, CUTOFF);
    expect(await model.get(id)).toMatchObject({
      status: "suspended",
      cronNotification: { kind: "suspended" },
    });
  });

  it("does not overwrite a payment committed after the candidate reread", async () => {
    const { model, id } = await subscriptionFixture();
    const mutate = model.mutateRevision.bind(model);
    vi.spyOn(model, "mutateRevision").mockImplementationOnce(
      async (current, patch) => {
        await mutate(current, { stripeSubscriptionId: "paid" });
        return mutate(current, patch);
      },
    );
    await model.expireFree(id, CUTOFF);
    expect(await model.get(id)).toMatchObject({
      status: "active",
      stripeSubscriptionId: "paid",
      cronNotification: null,
    });
  });

  it("retains an intent across lost acknowledgement without blindly retrying the mutation", async () => {
    const { model, id } = await subscriptionFixture();
    const mutate = model.mutateRevision.bind(model);
    const spy = vi
      .spyOn(model, "mutateRevision")
      .mockImplementationOnce(async (current, patch) => {
        await mutate(current, patch);
        return "unknown";
      });
    await expect(model.expireFree(id, CUTOFF)).rejects.toThrow("unknown");
    expect(spy).toHaveBeenCalledOnce();
    await deliverSubscriptionCronNotifications("free_expired");
    expect((await model.get(id))?.cronNotification).toBeNull();
  });

  it("checks the suspension cutoff and blocks busy or deleting subscriptions", async () => {
    const eligible = await subscriptionFixture({
      status: "past_due",
      pastDueSince: BEFORE,
    });
    const boundary = await subscriptionFixture({
      status: "past_due",
      pastDueSince: CUTOFF,
    });
    const busy = await subscriptionFixture({
      status: "past_due",
      pastDueSince: BEFORE,
      domainTransition: {
        operationId: "reactivate",
        kind: "reactivate",
        targetPlanId: null,
        requestedAt: CUTOFF,
      },
    });
    const deleting = await subscriptionFixture({
      status: "past_due",
      pastDueSince: BEFORE,
      deletionStartedAt: BEFORE,
    });
    for (const item of [eligible, boundary, busy, deleting])
      await item.model.suspendPastDue(item.id, CUTOFF);
    expect((await eligible.model.get(eligible.id))?.status).toBe("suspended");
    for (const item of [boundary, busy, deleting])
      expect((await item.model.get(item.id))?.status).toBe("past_due");
  });

  it("rediscovers an admitted deletion even after its updatedAt moves beyond retention cutoff", async () => {
    const { model, id } = await subscriptionFixture({ status: "cancelled" });
    await model.table.get(id).update({ updatedAt: BEFORE }).run();
    const admitted = await model.beginCancelledDeletion(id, CUTOFF);
    expect(admitted?.deletionStartedAt).toBeInstanceOf(Date);
    expect(
      (await model.findCancelledUpdatedBefore(BEFORE)).map((row) => row._id),
    ).toContain(id);
    await expect(model.update(id, { status: "active" })).rejects.toThrow();
    await model.finishDeletion(admitted!);
    await model.finishDeletion(admitted!);
    expect(await model.get(id)).toBeUndefined();
  });

  it("arbitrates reactivation and deletion before either can perform external effects", async () => {
    const { model, id } = await subscriptionFixture({ status: "cancelled" });
    await model.table.get(id).update({ updatedAt: BEFORE }).run();
    const snapshot = (await model.get(id))!;
    const results = await Promise.allSettled([
      model.beginCancelledDeletion(id, CUTOFF),
      model.beginTransition(snapshot, {
        operationId: "reactivate",
        kind: "reactivate",
        targetPlanId: null,
        requestedAt: CUTOFF,
      }),
    ]);
    const current = (await model.get(id))!;
    expect(Boolean(current.deletionStartedAt)).not.toBe(
      Boolean(current.domainTransition),
    );
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  });
});

describe("retention deletion replay", () => {
  it("retains admitted work and runs no hooks while lifecycle producers have not drained", async () => {
    const { model, id } = await subscriptionFixture({
      status: "cancelled",
      deletionStartedAt: BEFORE,
    });
    deletion.close.mockRejectedValueOnce(new Error("active producer"));
    scheduleHardDeleteCancelled();
    const tick = deletion.schedule.mock.calls[0][1];
    tick();
    await vi.waitFor(() => expect(deletion.close).toHaveBeenCalledOnce());
    expect(deletion.hooks).not.toHaveBeenCalled();
    expect((await model.get(id))?.deletionStartedAt).toEqual(BEFORE);
    tick();
    await vi.waitFor(async () => expect(await model.get(id)).toBeUndefined());
    expect(deletion.close).toHaveBeenCalledTimes(2);
    expect(deletion.close.mock.invocationCallOrder[1]).toBeLessThan(
      deletion.hooks.mock.invocationCallOrder[0],
    );
  });

  it("retains failed hook work and reuses its identity across overlapping restarts", async () => {
    const { model, id } = await subscriptionFixture({
      status: "cancelled",
      deletionStartedAt: BEFORE,
    });
    deletion.hooks.mockRejectedValueOnce(new Error("hook failed"));
    scheduleHardDeleteCancelled();
    const tick = deletion.schedule.mock.calls[0][1];
    tick();
    await vi.waitFor(() => expect(deletion.hooks).toHaveBeenCalledOnce());
    expect((await model.get(id))?.deletionStartedAt).toEqual(BEFORE);
    const identity = deletion.hooks.mock.calls[0][2];
    tick();
    tick();
    await vi.waitFor(async () => expect(await model.get(id)).toBeUndefined());
    expect(
      deletion.hooks.mock.calls
        .slice(1)
        .every((call) => call[2].operationId === identity.operationId),
    ).toBe(true);
    expect(deletion.hooks.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not admit active or unmarked orphan pending subscriptions", async () => {
    const active = await subscriptionFixture();
    const pending = await subscriptionFixture({ status: "pending_payment" });
    expect(
      await active.model.beginCancelledDeletion(active.id, CUTOFF),
    ).toBeUndefined();
    expect(
      await pending.model.beginCancelledDeletion(pending.id, CUTOFF),
    ).toBeUndefined();
    expect(
      await GetModel(
        TenantSubscriptionModel,
        CROSS_INSTANCE,
      ).findCancelledUpdatedBefore(CUTOFF),
    ).toEqual([]);
  });
});

describe("billing publication and tombstones on Mongo", () => {
  it("has one canonical row under overlapping first publication", async () => {
    const model = GetModel(TenantBillingStateModel);
    const outcomes = await Promise.all(
      Array.from({ length: CONTENDERS }, () =>
        model.upsertForTenant("tenant-a", "active", undefined),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await model.getAll()).toHaveLength(1);
    expect(await model.findByTenant("tenant-a")).toMatchObject({
      _id: "tenant-a",
      billingState: "active",
    });
    expect(await model.countByState("active")).toBe(1);
    expect(await model.countByState("suspended")).toBe(0);
  });

  it("rejects stale publication and prevents recreation after deletion", async () => {
    const model = GetModel(TenantBillingStateModel);
    await model.upsertForTenant("tenant-a", "active", undefined);
    const stale = await model.findByTenant("tenant-a");
    await model.upsertForTenant("tenant-a", "suspended", stale);
    expect(await model.upsertForTenant("tenant-a", "free", stale)).toBe(false);
    await model.deleteForTenant("tenant-a");
    expect(await model.upsertForTenant("tenant-a", "active", undefined)).toBe(
      false,
    );
    expect(await model.countByState("cancelled")).toBe(0);
    expect((await model.findByTenant("tenant-a"))?.deletedAt).toBeInstanceOf(
      Date,
    );
  });
});

describe("complete segment generations on Mongo", () => {
  it("publishes one complete membership set and count under overlap", async () => {
    const segment = await segmentFixture();
    const links = GetModel(UserSegmentModel);
    await Promise.all([
      links.replaceForSegment(segment, ["a", "b", "c"], CUTOFF),
      links.replaceForSegment(segment, ["d"], CUTOFF),
    ]);
    const users = (await links.listBySegment(segment._id))
      .map((row) => row.userId)
      .sort();
    expect([["a", "b", "c"], ["d"]]).toContainEqual(users);
    expect(
      (await GetModel(SegmentModel).get(segment._id))?.estimatedCount,
    ).toBe(users.length);
    expect(await links.getAll()).toHaveLength(users.length);
  });

  it("keeps the published generation through partial insertion and retries", async () => {
    const segment = await segmentFixture();
    const links = GetModel(UserSegmentModel);
    await links.replaceForSegment(segment, ["old"], BEFORE);
    const current = (await GetModel(SegmentModel).get(segment._id))!;
    const insert = links.insert.bind(links);
    vi.spyOn(links, "insert").mockImplementationOnce(async (rows) => {
      await insert(Array.isArray(rows) ? rows.slice(0, 1) : rows);
      throw new Error("partial insert");
    });
    await expect(
      links.replaceForSegment(current, ["new-a", "new-b"], CUTOFF),
    ).rejects.toThrow("partial insert");
    expect(
      (await links.listBySegment(segment._id)).map((row) => row.userId),
    ).toEqual(["old"]);
    expect(await links.listByUser("new-a")).toEqual([]);
    await links.replaceForSegment(current, ["new-a", "new-b"], CUTOFF);
    expect(
      (await links.listBySegment(segment._id)).map((row) => row.userId).sort(),
    ).toEqual(["new-a", "new-b"]);
    expect(
      (await links.listByUser("new-a")).map((row) => row.segmentId),
    ).toEqual([segment._id]);
    expect(await links.listByUser("old")).toEqual([]);
    expect(await links.getAll()).toHaveLength(2);
  });

  it("does not publish a generation based on edited conditions", async () => {
    const segment = await segmentFixture();
    const links = GetModel(UserSegmentModel);
    await GetModel(SegmentModel).update(segment._id, {
      conditions: { logical: "or", conditions: [] },
    });
    await links.replaceForSegment(segment, ["stale"], CUTOFF);
    expect(await links.listBySegment(segment._id)).toEqual([]);
    expect(await links.getAll()).toEqual([]);
  });

  it("retries a reader when publication and cleanup change its generation", async () => {
    const segment = await segmentFixture();
    const links = GetModel(UserSegmentModel);
    await links.replaceForSegment(segment, ["old"], BEFORE);
    const current = (await GetModel(SegmentModel).get(segment._id))!;
    const getBy = links.getBy.bind(links);
    vi.spyOn(links, "getBy").mockImplementationOnce(async (index, ...keys) => {
      const rows = await getBy(index, ...keys);
      await links.replaceForSegment(current, ["new"], CUTOFF);
      return rows;
    });
    expect(
      (await links.listBySegment(segment._id)).map((row) => row.userId),
    ).toEqual(["new"]);
  });

  it("does not collect generations published while the cleanup scan is in flight", async () => {
    const segment = await segmentFixture();
    const links = GetModel(UserSegmentModel);
    const getBy = links.getBy.bind(links);
    vi.spyOn(links, "getBy").mockImplementationOnce(async (index, ...keys) => {
      await links.replaceForSegment(segment, ["middle"], BEFORE);
      const current = (await GetModel(SegmentModel).get(segment._id))!;
      await links.replaceForSegment(current, ["latest"], CUTOFF);
      return getBy(index, ...keys);
    });
    await links.cleanupUnpublishable(segment._id);
    expect(
      (await links.listBySegment(segment._id)).map((row) => row.userId),
    ).toEqual(["latest"]);
  });
});

describe("terminal-only webhook cleanup on Mongo", () => {
  it("does not delete a terminal candidate modified after its reread", async () => {
    const model = GetModel(StripeWebhookEventModel);
    await model.insert({
      _id: "changed",
      result: "success",
      processedAt: BEFORE,
      revision: randomUUID(),
    });
    const get = model.get.bind(model);
    vi.spyOn(model, "get").mockImplementationOnce(async (id) => {
      const stale = await get(id);
      await model.markResult(
        id,
        stale!.revision!,
        "reconciliation_required",
        "manual review needed",
      );
      return stale;
    });
    await model.deleteProcessedBefore(CUTOFF);
    expect(await model.get("changed")).toMatchObject({
      result: "reconciliation_required",
    });
  });

  it("retains pending, failed and cutoff-boundary rows while overlapping cleanup is idempotent", async () => {
    const model = GetModel(StripeWebhookEventModel);
    await model.insert([
      {
        _id: "old-success",
        result: "success",
        processedAt: BEFORE,
        revision: randomUUID(),
      },
      {
        _id: "old-failed",
        result: "failed",
        processedAt: BEFORE,
        revision: randomUUID(),
      },
      {
        _id: "old-pending",
        result: "pending",
        processedAt: BEFORE,
        revision: randomUUID(),
      },
      {
        _id: "boundary",
        result: "skipped",
        processedAt: CUTOFF,
        revision: randomUUID(),
      },
    ]);
    await Promise.all([
      model.deleteProcessedBefore(CUTOFF),
      model.deleteProcessedBefore(CUTOFF),
    ]);
    expect((await model.getAll()).map((row) => row._id).sort()).toEqual([
      "boundary",
      "old-failed",
      "old-pending",
    ]);
  });
});
