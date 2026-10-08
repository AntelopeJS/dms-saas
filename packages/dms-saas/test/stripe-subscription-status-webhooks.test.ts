import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";

const TENANT_ID = "tenant_comp";
const DELETED_SUBSCRIPTION_ID = "sub_deleted";

const harness = vi.hoisted(() => ({
  local: undefined as Partial<TenantSubscription> | undefined,
  updateStatus: vi.fn(async () => undefined),
  notifyOwners: vi.fn(async () => undefined),
  retrieveSubscription: vi.fn(),
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: harness.retrieveSubscription },
  }),
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
  upsertInvoice: async () => undefined,
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

import {
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
} from "../src/stripe/webhook-handlers";

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

describe("invoice.payment_failed", () => {
  function failure(billingReason = "subscription_cycle"): Stripe.Event {
    return {
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_retry",
          customer: "cus_comp",
          amount_due: 2900,
          currency: "eur",
          billing_reason: billingReason,
          parent: { subscription_details: { subscription: "sub_live" } },
        },
      },
    } as Stripe.Event;
  }

  it("leaves the workspace active while an upgrade awaits 3D Secure", async () => {
    harness.local = { status: "active" };
    harness.retrieveSubscription.mockResolvedValue({
      pending_update: { expires_at: 1 },
      latest_invoice: { id: "in_retry", status: "open" },
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(harness.retrieveSubscription).toHaveBeenCalledWith("sub_live", {
      expand: ["latest_invoice"],
    });
    expect(harness.updateStatus).not.toHaveBeenCalled();
    expect(harness.notifyOwners).not.toHaveBeenCalled();
  });

  it("ignores the failed attempt of an upgrade paid since", async () => {
    harness.local = { status: "active" };
    harness.retrieveSubscription.mockResolvedValue({
      pending_update: null,
      latest_invoice: { id: "in_retry", status: "paid" },
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(harness.updateStatus).not.toHaveBeenCalled();
  });

  it("dunns an unpaid subscription update that applied regardless", async () => {
    harness.local = { status: "active" };
    harness.retrieveSubscription.mockResolvedValue({
      pending_update: null,
      latest_invoice: { id: "in_retry", status: "open" },
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(harness.updateStatus).toHaveBeenCalledWith(TENANT_ID, "past_due");
  });

  it("moves an active workspace to past due", async () => {
    harness.local = { status: "active" };

    await handleInvoicePaymentFailed(failure());

    expect(harness.updateStatus).toHaveBeenCalledWith(TENANT_ID, "past_due");
    expect(harness.retrieveSubscription).not.toHaveBeenCalled();
  });

  it.each(["suspended", "cancelled"] as const)(
    "keeps a %s workspace as it is when a retry fails",
    async (status) => {
      harness.local = { status };

      await handleInvoicePaymentFailed(failure());

      expect(harness.updateStatus).not.toHaveBeenCalled();
    },
  );
});
