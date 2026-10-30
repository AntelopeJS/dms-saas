import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { TenantBillingStateModel, TenantSubscriptionModel } from "../src/db";
import {
  applyWorkspaceReactivation,
  applyWorkspaceSuspension,
} from "../src/workspaces/suspension";
import { addTenantMember, createUser } from "./helpers/dms";
import { implementNotificationCore } from "./helpers/notification-core";
import { useLifecycleConsumer } from "./helpers/lifecycle-consumer";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";
import { latch } from "./helpers/latch";

useMongoDatabase("workspace-suspension-lifecycle");
const stripe = useSuiteStripe();
const core = implementNotificationCore();
const consume = useLifecycleConsumer("suspension.suite", [
  "suspended",
  "reactivation_requested",
]);

/**
 * A workspace with an owner and a Stripe-billed subscription in `status`,
 * and the order its effects reach the outside world in: access written,
 * billing state published, Stripe called, lifecycle consumer delivered.
 */
async function workspace(status: "active" | "suspended" = "active") {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  const subscriptions = GetModel(TenantSubscriptionModel, tenantId);
  await subscriptions.insert({
    _id: tenantId,
    status,
    stripeSubscriptionId: "sub_123",
  });
  const events: string[] = [];
  const writeAccess = subscriptions.updateDuringTransition.bind(subscriptions);
  vi.spyOn(subscriptions, "updateDuringTransition").mockImplementation(
    async (id, operationId, patch) => {
      const written = await writeAccess(id, operationId, patch);
      events.push(`access:${patch.status}`);
      return written;
    },
  );
  const billingStates = GetModel(TenantBillingStateModel);
  const publish = billingStates.upsertForTenant.bind(billingStates);
  vi.spyOn(billingStates, "upsertForTenant").mockImplementation(
    async (id, state, existing, directory) => {
      const published = await publish(id, state, existing, directory);
      events.push("recompute");
      return published;
    },
  );
  const stripeUpdate = vi
    .spyOn(stripe.write.subscriptions, "update")
    .mockImplementation(async () => {
      events.push("stripe");
      return fromPartial({});
    });
  consume.mockImplementation(async (message) => {
    events.push("lifecycle");
    return { receiptId: message.operationId };
  });
  const operationId = `lifecycle-operation-${tenantId}`;
  return {
    tenantId,
    operationId,
    ownerId: owner._id,
    events,
    stripeUpdate,
    subscriptions,
    input: (attemptCount = 1) => ({
      tenantId,
      operationId,
      requestedAt: new Date("2026-08-28T12:00:00.000Z"),
      attemptCount,
    }),
  };
}

describe("workspace lifecycle ordering", () => {
  it("performs no external effect when durable admission is uncertain", async () => {
    const { input, subscriptions, stripeUpdate } = await workspace();
    vi.spyOn(subscriptions, "beginTransition").mockRejectedValue(
      new Error("unknown outcome"),
    );

    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "unknown outcome",
    );

    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(core.sendToUsers).not.toHaveBeenCalled();
    expect((await subscriptions.findOne())?.status).toBe("active");
  });

  it("replays notification with the same identity after delivery failure", async () => {
    const { input, operationId, ownerId, subscriptions } = await workspace();
    core.sendToUsers.mockRejectedValueOnce(new Error("delivery unknown"));

    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "delivery unknown",
    );
    await applyWorkspaceSuspension(input(2));

    expect(core.sendToUsers).toHaveBeenCalledTimes(2);
    expect(core.sendToUsers.mock.calls[0]).toEqual(
      core.sendToUsers.mock.calls[1],
    );
    expect(core.sendToUsers.mock.calls[1]?.[0]).toEqual([ownerId]);
    expect(core.sendToUsers.mock.calls[1]?.[3]).toBe(
      `operator-suspended:${operationId}`,
    );
    expect((await subscriptions.findOne())?.domainTransition?.operationId).toBe(
      operationId,
    );
  });

  it("closes SaaS access before lifecycle delivery and keeps it closed on failure", async () => {
    const { input, operationId, events, stripeUpdate, subscriptions } =
      await workspace();
    let statusAtDelivery: string | undefined;
    consume.mockImplementation(async () => {
      events.push("lifecycle");
      statusAtDelivery = (await subscriptions.findOne())?.status;
      throw new Error("consumer unavailable");
    });

    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "consumer unavailable",
    );

    expect(events).toEqual([
      "access:suspended",
      "recompute",
      "stripe",
      "lifecycle",
    ]);
    expect(statusAtDelivery).toBe("suspended");
    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_123",
      { pause_collection: { behavior: "void" } },
      { idempotencyKey: `operator-suspend:${operationId}` },
    );
    expect((await subscriptions.findOne())?.status).toBe("suspended");
  });

  it("keeps access closed while reactivation consumers are pending", async () => {
    const { input, events, stripeUpdate, subscriptions } =
      await workspace("suspended");
    const delivery = latch();
    consume.mockImplementation(async (message) => {
      await delivery.promise;
      return { receiptId: message.operationId };
    });

    let settled = false;
    const reactivation = applyWorkspaceReactivation(input()).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    expect((await subscriptions.findOne())?.status).toBe("suspended");
    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    delivery.resolve();
    await reactivation;
    expect(events).toEqual(["stripe", "access:active", "recompute"]);
    expect((await subscriptions.findOne())?.status).toBe("active");
  });

  it("does not resume Stripe or access when reactivation delivery fails", async () => {
    const { input, events, stripeUpdate, subscriptions } =
      await workspace("suspended");
    consume.mockRejectedValue(new Error("wake rejected"));

    await expect(applyWorkspaceReactivation(input())).rejects.toThrow(
      "wake rejected",
    );

    expect((await subscriptions.findOne())?.status).toBe("suspended");
    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("recomputes access when a suspension retry finds the status applied", async () => {
    const { input, events } = await workspace("suspended");

    await expect(applyWorkspaceSuspension(input(2))).resolves.toMatchObject({
      status: "suspended",
    });

    expect(events).toEqual(["recompute", "stripe", "lifecycle"]);
  });

  it("recomputes access when a reactivation retry finds the status applied", async () => {
    const { input, events } = await workspace();

    await expect(applyWorkspaceReactivation(input(2))).resolves.toMatchObject({
      status: "active",
    });

    expect(events).toEqual(["lifecycle", "stripe", "recompute"]);
  });
});
