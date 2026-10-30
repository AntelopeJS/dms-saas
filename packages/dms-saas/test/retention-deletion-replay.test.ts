import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import {
  observeTenantLifecycle,
  runTenantLifecycleOperation,
} from "@antelopejs/interface-dms/tenant-lifecycle";
import type { ScheduledTask } from "node-cron";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { scheduleHardDeleteCancelled } from "../src/crons/hard-delete-cancelled";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  TenantSubscriptionModel,
} from "../src/db";
import {
  BEFORE,
  CUTOFF,
  subscriptionFixture,
} from "./helpers/subscription-fixture";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { ANY_STRING } from "./helpers/asymmetric-matchers";

useMongoDatabase("retention-deletion-replay");
const logs = captureLogs();

/** What the tenant looked like to the deletion hook when it ran. */
interface DeletionHookRun {
  tenantId: string;
  operationId: string | undefined;
  closed: boolean;
  activeProducers: number;
}

const hookRuns: DeletionHookRun[] = [];
const hookFailures: Error[] = [];

RegisterHook(Hook.TENANT_DELETED, async (tenantId, context) => {
  const lifecycle = await observeTenantLifecycle(tenantId);
  hookRuns.push({
    tenantId,
    operationId: context?.operationId,
    closed: lifecycle.closed,
    activeProducers: lifecycle.activeAttemptIds.length,
  });
  const failure = hookFailures.shift();
  if (failure) throw failure;
});

let task: ScheduledTask;

beforeAll(async () => {
  await GetModel(BillingSettingsModel).insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    dataRetentionDaysAfterCancellation: 1,
  });
});

beforeEach(async () => {
  hookRuns.length = 0;
  hookFailures.length = 0;
  await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).table.delete().run();
  task = scheduleHardDeleteCancelled();
  await task.stop();
});

afterEach(async () => {
  await task.destroy();
});

describe("retention deletion replay", () => {
  it("retains admitted work and runs no hooks while lifecycle producers have not drained", async () => {
    const { model, id, tenantId } = await subscriptionFixture({
      status: "cancelled",
      deletionStartedAt: BEFORE,
    });
    const drained = Promise.withResolvers<void>();
    const producer = runTenantLifecycleOperation(
      tenantId,
      () => drained.promise,
    );
    await vi.waitFor(async () =>
      expect(
        (await observeTenantLifecycle(tenantId)).activeAttemptIds,
      ).toHaveLength(1),
    );

    await task.execute();

    await vi.waitFor(() => expect(logs.at("ERROR")).toHaveLength(1));
    expect(logs.at("ERROR")).toEqual([
      [
        `[dms-saas:cron:hard-delete-cancelled] failed to delete tenant ${tenantId}`,
        expect.objectContaining({
          message:
            "Tenant lifecycle deletion blocked by active or indeterminate attempts",
        }),
      ],
    ]);
    expect(hookRuns).toEqual([]);
    expect((await model.get(id))?.deletionStartedAt).toEqual(BEFORE);
    drained.resolve();
    await producer;

    await task.execute();

    await vi.waitFor(async () => expect(await model.get(id)).toBeUndefined());
    expect(hookRuns).toEqual([
      {
        tenantId,
        operationId: ANY_STRING,
        closed: true,
        activeProducers: 0,
      },
    ]);
  });

  it("retains failed hook work and reuses its identity across overlapping restarts", async () => {
    const { model, id } = await subscriptionFixture({
      status: "cancelled",
      deletionStartedAt: BEFORE,
    });
    hookFailures.push(new Error("hook failed"));

    await task.execute();

    await vi.waitFor(() => expect(logs.at("ERROR")).toHaveLength(1));
    expect(hookRuns).toHaveLength(1);
    expect((await model.get(id))?.deletionStartedAt).toEqual(BEFORE);
    const { operationId } = hookRuns[0]!;
    expect(operationId).toEqual(expect.any(String));

    await Promise.all([task.execute(), task.execute()]);

    await vi.waitFor(async () => expect(await model.get(id)).toBeUndefined());
    expect(hookRuns.length).toBeGreaterThan(1);
    expect(hookRuns.map((run) => run.operationId)).toEqual(
      hookRuns.map(() => operationId),
    );
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
