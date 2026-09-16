import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  schedule: vi.fn(),
  find: vi.fn(),
  current: vi.fn(),
  notify: vi.fn(),
  error: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: { schedule: dependencies.schedule } }));
vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: dependencies.error },
}));
vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: () => ({
    findFreeEndingBetween: dependencies.find,
    findOne: dependencies.current,
  }),
}));
vi.mock("../src/db", () => ({ TenantSubscriptionModel: class {} }));
vi.mock("../src/utils", () => ({ getRowInstance: () => "tenant-a" }));
vi.mock("../src/notifications", () => ({
  freeWorkspaceEndingSoonSubject: "ending-soon",
  notifyTenantOwners: dependencies.notify,
}));

import { scheduleNotifyFreeWorkspacesEndingSoon } from "../src/crons/notify-free-workspaces-ending-soon";

const now = new Date("2026-09-14T03:00:00Z");
const subscription = {
  _id: "subscription-a",
  status: "active",
  stripeSubscriptionId: null,
  freeUntil: new Date("2026-09-15T02:00:00Z"),
};

async function tick(): Promise<void> {
  dependencies.schedule.mock.calls[0][1]();
  await vi.waitFor(() => expect(dependencies.find).toHaveBeenCalled());
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  dependencies.find.mockResolvedValue([subscription]);
  dependencies.current.mockResolvedValue(subscription);
  scheduleNotifyFreeWorkspacesEndingSoon();
});

afterEach(() => vi.restoreAllMocks());

describe("free workspace warning retries", () => {
  it("catches up missed days and forwards one stable identity across overlapping runs", async () => {
    await Promise.all([tick(), tick()]);
    expect(dependencies.find).toHaveBeenCalledWith(
      now,
      new Date("2026-09-18T03:00:00Z"),
    );
    expect(dependencies.notify).toHaveBeenCalledTimes(2);
    const expectedPayload = expect.objectContaining({
      eventId:
        '["notify-free-workspaces-ending-soon","tenant-a","subscription-a","2026-09-15T02:00:00.000Z"]',
    });
    expect(dependencies.notify).toHaveBeenNthCalledWith(
      1,
      "tenant-a",
      "ending-soon",
      expectedPayload,
    );
    expect(dependencies.notify).toHaveBeenNthCalledWith(
      2,
      "tenant-a",
      "ending-soon",
      expectedPayload,
    );
  });

  it.each([
    undefined,
    { ...subscription, status: "cancelled" },
    { ...subscription, stripeSubscriptionId: "stripe-paid" },
    { ...subscription, _id: "replacement" },
    { ...subscription, freeUntil: new Date("2026-09-20T00:00:00Z") },
    { ...subscription, freeUntil: now },
  ])(
    "skips a candidate whose current state no longer matches",
    async (current) => {
      dependencies.current.mockResolvedValue(current);
      await tick();
      expect(dependencies.notify).not.toHaveBeenCalled();
    },
  );

  it("continues after a failed tenant and replays the failed event next run", async () => {
    const second = { ...subscription, _id: "subscription-b" };
    dependencies.find.mockResolvedValue([subscription, second]);
    dependencies.current
      .mockResolvedValueOnce(subscription)
      .mockResolvedValueOnce(second);
    dependencies.notify.mockRejectedValueOnce(new Error("delivery failed"));
    await tick();
    expect(dependencies.notify).toHaveBeenCalledTimes(2);
    expect(dependencies.notify.mock.calls[1][2].eventId).toContain(
      "subscription-b",
    );
    expect(dependencies.error).toHaveBeenCalledOnce();
    dependencies.find.mockResolvedValue([subscription]);
    await tick();
    expect(dependencies.notify).toHaveBeenCalledTimes(3);
    expect(dependencies.notify.mock.calls[2]).toEqual(
      dependencies.notify.mock.calls[0],
    );
  });
});
