import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionTransition, TenantSubscription } from "../src/db";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface SuspensionInput {
  tenantId: string;
  operationId: string;
  requestedAt: Date;
  attemptCount: number;
}

interface NamedModel {
  name: string;
}

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  events: [] as string[],
  dispatch: vi.fn<() => Promise<void>>(),
  stripeUpdate: vi.fn<() => Promise<void>>(),
  recompute: vi.fn<() => Promise<void>>(),
  admission: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...original,
    GetModel: (model: NamedModel): unknown => harness.models.get(model.name),
  };
});

vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: (...args: unknown[]) =>
    harness.recompute(...args),
}));

vi.mock("../src/operator-actions/lifecycle-outbox", () => ({
  dispatchWorkspaceLifecycle: (...args: unknown[]) => harness.dispatch(...args),
}));

vi.mock("../src/notifications", () => ({
  notifyTenantOwners: (...args: unknown[]) => harness.notify(...args),
  workspaceReactivatedSubject: "workspace-reactivated",
  workspaceSuspendedSubject: "workspace-suspended",
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: {
      update: (...args: unknown[]) => harness.stripeUpdate(...args),
    },
  }),
}));

import {
  applyWorkspaceReactivation,
  applyWorkspaceSuspension,
} from "../src/workspaces/suspension";

let subscription: TenantSubscription;

function deferred(): Deferred {
  let resolve = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function subscriptionModel(): object {
  return {
    findOne: async () => subscription,
    beginTransition: async (
      _current: TenantSubscription,
      intent: SubscriptionTransition,
    ) => {
      await harness.admission(intent);
      subscription.domainTransition = intent;
    },
    updateDuringTransition: async (
      _id: string,
      operationId: string,
      patch: Partial<TenantSubscription>,
    ) => {
      expect(subscription.domainTransition?.operationId).toBe(operationId);
      Object.assign(subscription, patch);
      harness.events.push(`access:${subscription.status}`);
    },
  };
}

function input(attemptCount = 1): SuspensionInput {
  return {
    tenantId: "tenant-123",
    operationId: "lifecycle-operation-123",
    requestedAt: new Date("2026-08-28T12:00:00.000Z"),
    attemptCount,
  };
}

beforeEach(() => {
  subscription = {
    _id: "subscription-123",
    status: "active",
    stripeSubscriptionId: "sub_123",
  } as TenantSubscription;
  harness.models.clear();
  harness.events.length = 0;
  harness.models.set("TenantSubscriptionModel", subscriptionModel());
  harness.recompute.mockReset().mockImplementation(async () => {
    harness.events.push("recompute");
  });
  harness.stripeUpdate.mockReset().mockImplementation(async () => {
    harness.events.push("stripe");
  });
  harness.dispatch.mockReset();
  harness.admission.mockReset();
  harness.notify.mockReset();
});

describe("workspace lifecycle ordering", () => {
  it("performs no external effect when durable admission is uncertain", async () => {
    harness.admission.mockRejectedValue(new Error("unknown outcome"));
    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "unknown outcome",
    );
    expect(harness.stripeUpdate).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(subscription.status).toBe("active");
  });

  it("replays notification with the same identity after delivery failure", async () => {
    harness.notify.mockRejectedValueOnce(new Error("delivery unknown"));
    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "delivery unknown",
    );
    await applyWorkspaceSuspension(input(2));
    expect(harness.notify).toHaveBeenCalledTimes(2);
    expect(harness.notify.mock.calls[0]).toEqual(harness.notify.mock.calls[1]);
    expect(harness.notify.mock.calls[1][2].eventId).toBe(
      "operator-suspended:lifecycle-operation-123",
    );
    expect(subscription.domainTransition?.operationId).toBe(
      input().operationId,
    );
  });

  it("closes SaaS access before lifecycle delivery and keeps it closed on failure", async () => {
    harness.dispatch.mockImplementation(async () => {
      harness.events.push("lifecycle");
      expect(subscription.status).toBe("suspended");
      throw new Error("consumer unavailable");
    });

    await expect(applyWorkspaceSuspension(input())).rejects.toThrow(
      "consumer unavailable",
    );
    expect(harness.events).toEqual([
      "access:suspended",
      "recompute",
      "stripe",
      "lifecycle",
    ]);
    expect(subscription.status).toBe("suspended");
  });

  it("keeps access closed while reactivation consumers are pending", async () => {
    subscription.status = "suspended";
    const delivery = deferred();
    harness.dispatch.mockImplementation(async () => delivery.promise);

    let settled = false;
    const reactivation = applyWorkspaceReactivation(input()).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(harness.dispatch).toHaveBeenCalledOnce());
    expect(subscription.status).toBe("suspended");
    expect(harness.stripeUpdate).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    delivery.resolve();
    await reactivation;
    expect(harness.events).toEqual(["stripe", "access:active", "recompute"]);
    expect(subscription.status).toBe("active");
  });

  it("does not resume Stripe or access when reactivation delivery fails", async () => {
    subscription.status = "suspended";
    harness.dispatch.mockRejectedValue(new Error("wake rejected"));

    await expect(applyWorkspaceReactivation(input())).rejects.toThrow(
      "wake rejected",
    );
    expect(subscription.status).toBe("suspended");
    expect(harness.stripeUpdate).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });

  it("recomputes access when a suspension retry finds the status applied", async () => {
    subscription.status = "suspended";
    harness.dispatch.mockImplementation(async () => {
      harness.events.push("lifecycle");
    });

    await expect(applyWorkspaceSuspension(input(2))).resolves.toMatchObject({
      status: "suspended",
    });
    expect(harness.events).toEqual(["recompute", "stripe", "lifecycle"]);
  });

  it("recomputes access when a reactivation retry finds the status applied", async () => {
    harness.dispatch.mockImplementation(async () => {
      harness.events.push("lifecycle");
    });

    await expect(applyWorkspaceReactivation(input(2))).resolves.toMatchObject({
      status: "active",
    });
    expect(harness.events).toEqual(["lifecycle", "stripe", "recompute"]);
  });
});
