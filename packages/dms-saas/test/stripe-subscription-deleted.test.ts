import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";

const TENANT_ID = "tenant_comp";
const DELETED_SUBSCRIPTION_ID = "sub_deleted";

const harness = vi.hoisted(() => ({
  local: undefined as Partial<TenantSubscription> | undefined,
  updateStatus: vi.fn(async () => undefined),
  notifyOwners: vi.fn(async () => undefined),
}));

vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: (model: { name: string }) =>
      ({
        TenantSubscriptionModel: { findOne: async () => harness.local },
        BillingSettingsModel: { get: async () => undefined },
      })[model.name],
  }),
);
vi.mock("../src/stripe/webhook-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/webhook-shared")>()),
  findTenantByCustomerId: async () => ({ _id: TENANT_ID }),
  updateSubscriptionStatus: harness.updateStatus,
}));
vi.mock("../src/plan-changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plan-changes")>()),
  applyPendingFreePlanOnCancellation: async () => false,
}));
vi.mock("../src/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/notifications")>()),
  notifyTenantOwners: harness.notifyOwners,
}));
vi.mock("../src/automation", () => ({ emitAutomationEvent: vi.fn() }));

import { handleSubscriptionDeleted } from "../src/stripe/webhook-handlers";

function deletion(): Stripe.Event {
  return {
    type: "customer.subscription.deleted",
    data: { object: { id: DELETED_SUBSCRIPTION_ID, customer: "cus_comp" } },
  } as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("customer.subscription.deleted", () => {
  it("cancels the workspace that was billed on the subscription", async () => {
    harness.local = { stripeSubscriptionId: DELETED_SUBSCRIPTION_ID };

    await handleSubscriptionDeleted(deletion());

    expect(harness.updateStatus).toHaveBeenCalledWith(TENANT_ID, "cancelled");
    expect(harness.notifyOwners).toHaveBeenCalled();
  });

  it("leaves a workspace already moved off the subscription as it is", async () => {
    harness.local = {
      status: "active",
      isComplimentary: true,
      stripeSubscriptionId: null,
    };

    await handleSubscriptionDeleted(deletion());

    expect(harness.updateStatus).not.toHaveBeenCalled();
    expect(harness.notifyOwners).not.toHaveBeenCalled();
  });
});
