import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ScheduledTask } from "node-cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import {
  AutomationClaimModel,
  automationClaimId,
} from "../src/automation/db/automation-claim.model";
import { scheduleNotifyFreeWorkspacesEndingSoon } from "../src/crons/notify-free-workspaces-ending-soon";
import { type TenantSubscription, TenantSubscriptionModel } from "../src/db";
import {
  armTrigger,
  deliveryIds,
  implementAutomationCatalog,
} from "./helpers/automation";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";

useMongoDatabase();
const core = implementNotificationCore();
const automation = implementAutomationCatalog();
await registerAutomationNodes();

const DAY_MS = 86_400_000;
const firstRun = new Date("2026-09-14T03:00:00Z");
const freeUntil = new Date("2026-09-17T12:00:00Z");

let clock = firstRun.getTime();
let task: ScheduledTask;

async function freeWorkspace(
  fields: Partial<TenantSubscription> & { until?: Date } = {},
): Promise<string> {
  const tenantId = randomUUID();
  await addTenantMember(tenantId, await createUser(), true);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: `sub-${tenantId}`,
    planId: "complimentary",
    status: "active",
    stripeSubscriptionId: null,
    ...fields,
    freeUntil: fields.until ?? freeUntil,
  });
  return tenantId;
}

/**
 * Makes the daily job reach `tenantId` after every other candidate, so once
 * its notification is sent the job has judged them all.
 */
function scanLast(tenantId: string): void {
  const model = GetModel(TenantSubscriptionModel, CROSS_INSTANCE);
  const scan = model.findFreeEndingBetween.bind(model);
  vi.spyOn(model, "findFreeEndingBetween").mockImplementation(
    async (start, end) =>
      (await scan(start, end)).sort(
        (left, right) =>
          Number(left._id === `sub-${tenantId}`) -
          Number(right._id === `sub-${tenantId}`),
      ),
  );
}

/** Runs the daily job once and waits for its owner notifications. */
async function runDay(expectedSends: number): Promise<void> {
  await task.execute();
  await vi.waitFor(() =>
    expect(core.sendToUsers.mock.calls.length).toBeGreaterThanOrEqual(
      expectedSends,
    ),
  );
}

beforeEach(async () => {
  clock = firstRun.getTime();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).table.delete().run();
  task = scheduleNotifyFreeWorkspacesEndingSoon();
  await task.stop();
});

afterEach(async () => {
  await task.destroy();
  vi.restoreAllMocks();
});

describe("saas.free-access-ending", () => {
  it("fires on the first daily run that sees the end date, and on no later one", async () => {
    const tenantId = await freeWorkspace();
    const payloads = await armTrigger(automation, "saas.free-access-ending");

    await runDay(1);
    for (let day = 1; day <= 3; day += 1) {
      clock = firstRun.getTime() + day * DAY_MS;
      await runDay(day + 1);
    }

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId,
        freeUntil: freeUntil.toISOString(),
        planId: "complimentary",
        daysLeft: 3,
      }),
    ]);
  });

  it("fires again once the end date moves", async () => {
    const tenantId = await freeWorkspace();
    const payloads = await armTrigger(automation, "saas.free-access-ending");
    await runDay(1);

    await GetModel(TenantSubscriptionModel, tenantId).update(
      `sub-${tenantId}`,
      {
        freeUntil: new Date(freeUntil.getTime() + DAY_MS / 2),
      },
    );
    await runDay(2);

    const [first, moved] = deliveryIds(payloads);
    expect(payloads).toHaveLength(2);
    expect(moved).not.toBe(first);
  });

  it("does not fire for a workspace billed on Stripe", async () => {
    await freeWorkspace({ stripeSubscriptionId: "sub_paid" });
    const control = await freeWorkspace();
    scanLast(control);
    const payloads = await armTrigger(automation, "saas.free-access-ending");

    await runDay(1);

    expect(payloads).toEqual([expect.objectContaining({ tenantId: control })]);
  });

  it.each<[string, Partial<TenantSubscription>]>([
    ["whose data deletion has started", { deletionStartedAt: firstRun }],
    [
      "its owner deleted",
      {
        status: "cancelled",
        deletionRequestedAt: firstRun,
        deletionRequestedBy: "owner",
      },
    ],
  ])("does not fire for a workspace %s", async (_case, fields) => {
    await freeWorkspace(fields);
    const control = await freeWorkspace();
    scanLast(control);
    const payloads = await armTrigger(automation, "saas.free-access-ending");

    await runDay(1);

    expect(payloads).toEqual([expect.objectContaining({ tenantId: control })]);
  });

  it("still warns the owners when the claim cannot be stored", async () => {
    await freeWorkspace();
    vi.spyOn(GetModel(AutomationClaimModel), "claim").mockRejectedValue(
      new Error("claims unavailable"),
    );
    const payloads = await armTrigger(automation, "saas.free-access-ending");

    await runDay(1);

    expect(core.sendToUsers).toHaveBeenCalledOnce();
    expect(payloads).toEqual([]);
  });

  it("fires once for two overlapping runs", async () => {
    await freeWorkspace();
    const payloads = await armTrigger(automation, "saas.free-access-ending");

    await Promise.all([task.execute(), task.execute()]);
    await vi.waitFor(() => expect(core.sendToUsers).toHaveBeenCalledTimes(2));

    expect(payloads).toHaveLength(1);
  });
});

describe("automation claims", () => {
  it("keeps the claims of two workspaces on one delivery apart", async () => {
    const claims = GetModel(AutomationClaimModel);
    const deliveryId = `delivery-${randomUUID()}`;

    const outcomes = [
      await claims.claim("tenant-a", deliveryId),
      await claims.claim("tenant-b", deliveryId),
      await claims.claim("tenant-a", deliveryId),
    ];

    expect(outcomes).toEqual([true, true, false]);
  });

  it("removes only the claims older than the cutoff", async () => {
    vi.restoreAllMocks();
    const claims = GetModel(AutomationClaimModel);
    const old = `old-${randomUUID()}`;
    const recent = `recent-${randomUUID()}`;
    await claims.claim("tenant-a", old);
    await claims.claim("tenant-a", recent);
    await claims.update(automationClaimId("tenant-a", old), {
      createdAt: new Date(Date.now() - 31 * DAY_MS),
    });

    await claims.deleteClaimedBefore(new Date(Date.now() - 30 * DAY_MS));

    expect([
      await claims.claim("tenant-a", old),
      await claims.claim("tenant-a", recent),
    ]).toEqual([true, false]);
  });
});
