import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ScheduledTask } from "node-cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleNotifyFreeWorkspacesEndingSoon } from "../src/crons/notify-free-workspaces-ending-soon";
import { type TenantSubscription, TenantSubscriptionModel } from "../src/db";
import { freeWorkspaceEndingSoonSubject } from "../src/notifications/subjects";
import { addTenantMember, createUser } from "./helpers/dms";
import { implementNotificationCore } from "./helpers/notification-core";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("free-workspace-warning-cron");
const core = implementNotificationCore();
const logs = captureLogs();

const now = new Date("2026-09-14T03:00:00Z");
const windowEnd = new Date("2026-09-18T03:00:00Z");
const endingAt = new Date("2026-09-15T02:00:00Z");

/** The identity the cron gives the warning of a subscription, as the notification core sees it. */
function warningKey(
  tenantId: string,
  subscriptionId: string,
  freeUntil: Date,
): string {
  return JSON.stringify([
    "notify-free-workspaces-ending-soon",
    tenantId,
    subscriptionId,
    freeUntil.toISOString(),
  ]);
}

/** The recipients, subject and event key of each send the notification core received. */
function sends() {
  return core.sendToUsers.mock.calls.map(
    ([userIds, data, , idempotencyKey]) => ({
      userIds,
      subject: data.subject,
      idempotencyKey,
    }),
  );
}

/** Warnings expected for an owner, once per run that reached them. */
function warning(owner: string, key: string) {
  return {
    userIds: [owner],
    subject: freeWorkspaceEndingSoonSubject,
    idempotencyKey: key,
  };
}

interface EndingWorkspace {
  tenantId: string;
  ownerId: string;
  subscriptionId: string;
  freeUntil: Date;
}

/** A card-less workspace on complimentary access until `freeUntil`, with its owner. */
async function endingWorkspace(
  subscriptionId: string,
  freeUntil = endingAt,
): Promise<EndingWorkspace> {
  const tenantId = randomUUID();
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: subscriptionId,
    status: "active",
    stripeSubscriptionId: null,
    freeUntil,
  });
  return { tenantId, ownerId: owner._id, subscriptionId, freeUntil };
}

/**
 * Lets the cron's real scan find its candidates, in subscription order, then
 * runs `change` on them, on every scan of the test, before the cron re-reads each workspace: what happens
 * to a workspace between the scan and its notification.
 */
function changeAfterScan(
  change: (found: TenantSubscription[]) => Promise<void>,
): void {
  const model = GetModel(TenantSubscriptionModel, CROSS_INSTANCE);
  const scan = model.findFreeEndingBetween.bind(model);
  vi.spyOn(model, "findFreeEndingBetween").mockImplementation(
    async (start, end) => {
      const found = (await scan(start, end)).sort((left, right) =>
        left._id.localeCompare(right._id),
      );
      await change(found);
      return found;
    },
  );
}

let task: ScheduledTask;

/** Runs the scheduled task once, as its schedule would at 03:00. */
function tick(): Promise<void> {
  return task.execute();
}

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).table.delete().run();
  task = scheduleNotifyFreeWorkspacesEndingSoon();
  await task.stop();
});

afterEach(async () => {
  await task.destroy();
  vi.restoreAllMocks();
});

describe("free workspace warning retries", () => {
  it("catches up missed days and forwards one stable identity across overlapping runs", async () => {
    const first = await endingWorkspace("subscription-a");
    const last = await endingWorkspace(
      "subscription-b",
      new Date(windowEnd.getTime() - 1),
    );
    await endingWorkspace("beyond", windowEnd);
    await endingWorkspace("past", new Date(now.getTime() - 1));
    await endingWorkspace("due", now);

    changeAfterScan(async () => undefined);

    await Promise.all([tick(), tick()]);

    await vi.waitFor(() => expect(sends()).toHaveLength(4));
    const expected = [first, last].map((workspace) =>
      warning(
        workspace.ownerId,
        warningKey(
          workspace.tenantId,
          workspace.subscriptionId,
          workspace.freeUntil,
        ),
      ),
    );
    expect(sends().sort(byKey)).toEqual([...expected, ...expected].sort(byKey));
  });

  it.each([
    async (workspace: EndingWorkspace) =>
      GetModel(TenantSubscriptionModel, workspace.tenantId)
        .table.get(workspace.subscriptionId)
        .delete()
        .run(),
    async (workspace: EndingWorkspace) =>
      GetModel(TenantSubscriptionModel, workspace.tenantId).update(
        workspace.subscriptionId,
        { status: "cancelled" },
      ),
    async (workspace: EndingWorkspace) =>
      GetModel(TenantSubscriptionModel, workspace.tenantId).update(
        workspace.subscriptionId,
        { stripeSubscriptionId: "stripe-paid" },
      ),
    async (workspace: EndingWorkspace) => {
      const model = GetModel(TenantSubscriptionModel, workspace.tenantId);
      await model.table.get(workspace.subscriptionId).delete().run();
      await model.insert({
        _id: "replacement",
        status: "active",
        stripeSubscriptionId: null,
        freeUntil: workspace.freeUntil,
      });
    },
    async (workspace: EndingWorkspace) =>
      GetModel(TenantSubscriptionModel, workspace.tenantId).update(
        workspace.subscriptionId,
        { freeUntil: new Date("2026-09-20T00:00:00Z") },
      ),
    async (workspace: EndingWorkspace) =>
      GetModel(TenantSubscriptionModel, workspace.tenantId).update(
        workspace.subscriptionId,
        { freeUntil: now },
      ),
  ])(
    "skips a candidate whose current state no longer matches",
    async (change) => {
      const changed = await endingWorkspace("subscription-a");
      const control = await endingWorkspace("subscription-b");
      changeAfterScan(async () => {
        await change(changed);
      });

      await tick();

      await vi.waitFor(() => expect(sends()).toHaveLength(1));
      expect(sends()).toEqual([
        warning(
          control.ownerId,
          warningKey(control.tenantId, "subscription-b", endingAt),
        ),
      ]);
      expect(logs.at("ERROR")).toEqual([]);
    },
  );

  it("continues after a failed tenant and replays the failed event next run", async () => {
    const failing = await endingWorkspace("subscription-a");
    const other = await endingWorkspace("subscription-b");
    const failure = new Error("delivery failed");
    core.sendToUsers.mockRejectedValueOnce(failure);
    changeAfterScan(async () => undefined);

    await tick();

    await vi.waitFor(() => expect(sends()).toHaveLength(2));
    expect(sends().map((send) => send.idempotencyKey)).toEqual([
      warningKey(failing.tenantId, "subscription-a", endingAt),
      warningKey(other.tenantId, "subscription-b", endingAt),
    ]);
    expect(logs.at("ERROR")).toEqual([
      [
        "[dms-saas:cron:notify-free-workspaces-ending-soon] delivery failed",
        failure,
      ],
    ]);
    await GetModel(TenantSubscriptionModel, other.tenantId).update(
      "subscription-b",
      { status: "cancelled" },
    );

    await tick();

    await vi.waitFor(() => expect(sends()).toHaveLength(3));
    expect(sends()[2]).toEqual(sends()[0]);
  });
});

function byKey(
  left: { idempotencyKey?: string },
  right: { idempotencyKey?: string },
): number {
  return (left.idempotencyKey ?? "").localeCompare(right.idempotencyKey ?? "");
}
