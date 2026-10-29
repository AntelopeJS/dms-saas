import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as notifications from "@antelopejs/interface-dms/notifications";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import {
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
} from "../src/stripe/webhook-handlers";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-subscription-status-webhooks");
const stripe = useSuiteStripe();

const sendToUser = vi.fn<typeof notifications.internal.SendToUser>();
const DELETED_SUBSCRIPTION_ID = "sub_deleted";

ImplementInterface(notifications, {
  internal: {
    SupportsIdempotency: async () => false,
    RegisterNotificationCategory: {
      register: () => undefined,
      unregister: () => undefined,
    },
    RegisterNotificationSubject: {
      register: () => undefined,
      unregister: () => undefined,
    },
    SendToUser: sendToUser,
    SendToUsers: vi.fn(),
    SendToRoles: vi.fn(),
    SendToAll: vi.fn(),
  },
});

interface Workspace {
  tenantId: string;
  customerId: string;
  invoiceId: string;
  ownerId: string;
}

let workspace: Workspace;

/**
 * A workspace with an owner and a plain member, billed to a fresh Stripe
 * customer with the subscription row `row` overrides.
 */
async function seedWorkspace(
  row: Partial<TenantSubscription> = {},
): Promise<Workspace> {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  await addTenantMember(tenantId, await createUser());
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    stripeCustomerId: customerId,
    ...row,
  });
  return {
    tenantId,
    customerId,
    invoiceId: `in_${randomUUID()}`,
    ownerId: owner._id,
  };
}

async function statusOf(tenantId: string) {
  return (await GetModel(TenantSubscriptionModel, tenantId).findOne())?.status;
}

/** The ids of the users the workspace was notified through. */
function notifiedUserIds(): string[] {
  return sendToUser.mock.calls.map(([userId]) => userId);
}

beforeEach(async () => {
  sendToUser.mockReset();
  await GetModel(BillingSettingsModel).delete(BILLING_SETTINGS_SINGLETON_ID);
});

describe("customer.subscription.deleted", () => {
  function deletion(): Stripe.Event {
    return fromPartial<Stripe.Event>({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: DELETED_SUBSCRIPTION_ID,
          customer: workspace.customerId,
        },
      },
    });
  }

  it("cancels the workspace that was billed on the subscription", async () => {
    workspace = await seedWorkspace({
      stripeSubscriptionId: DELETED_SUBSCRIPTION_ID,
    });

    await handleSubscriptionDeleted(deletion());

    expect(await statusOf(workspace.tenantId)).toBe("cancelled");
    expect(notifiedUserIds()).toEqual([workspace.ownerId]);
  });

  it("leaves a workspace already moved off the subscription as it is", async () => {
    workspace = await seedWorkspace({
      status: "active",
      isComplimentary: true,
      stripeSubscriptionId: null,
    });

    await handleSubscriptionDeleted(deletion());

    expect(await statusOf(workspace.tenantId)).toBe("active");
    expect(notifiedUserIds()).toEqual([]);
  });
});

describe("automatic prorated refund on cancellation", () => {
  const SUBSCRIPTION_START = 1_800_000_000;
  const PERIOD_END = SUBSCRIPTION_START + 30 * 86_400;

  function deletionOfSubscriptionStartedAt(): Stripe.Event {
    return fromPartial<Stripe.Event>({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: DELETED_SUBSCRIPTION_ID,
          customer: workspace.customerId,
          start_date: SUBSCRIPTION_START,
          ended_at: SUBSCRIPTION_START + 86_400,
          items: {
            data: [
              {
                current_period_start: SUBSCRIPTION_START,
                current_period_end: PERIOD_END,
              },
            ],
          },
        },
      },
    });
  }

  function stubStripeLists() {
    vi.spyOn(stripe.write.invoices, "list").mockResolvedValue(
      fromPartial({ data: [{ id: "in_paid", amount_paid: 3000 }] }),
    );
    vi.spyOn(stripe.write.creditNotes, "list").mockResolvedValue(
      fromPartial({ data: [] }),
    );
    return vi
      .spyOn(stripe.write.creditNotes, "create")
      .mockResolvedValue(fromPartial({}));
  }

  beforeEach(async () => {
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      autoProrataOnCancelEnabled: true,
    });
  });

  it("is skipped for the subscription the money-back refund already settled", async () => {
    const create = stubStripeLists();
    workspace = await seedWorkspace({
      stripeSubscriptionId: DELETED_SUBSCRIPTION_ID,
      refundRequestedAt: new Date((SUBSCRIPTION_START + 3600) * 1000),
    });

    await handleSubscriptionDeleted(deletionOfSubscriptionStartedAt());

    expect(create).not.toHaveBeenCalled();
  });

  it("still applies to a subscription started after an earlier refund", async () => {
    const create = stubStripeLists();
    workspace = await seedWorkspace({
      stripeSubscriptionId: DELETED_SUBSCRIPTION_ID,
      refundRequestedAt: new Date((SUBSCRIPTION_START - 86_400) * 1000),
    });

    await handleSubscriptionDeleted(deletionOfSubscriptionStartedAt());

    expect(create).toHaveBeenCalledOnce();
  });
});

describe("invoice.payment_failed", () => {
  function failure(billingReason = "subscription_cycle"): Stripe.Event {
    return fromPartial<Stripe.Event>({
      type: "invoice.payment_failed",
      data: {
        object: {
          id: workspace.invoiceId,
          customer: workspace.customerId,
          amount_due: 2900,
          currency: "eur",
          billing_reason: billingReason,
          lines: { object: "list", data: [], has_more: false, url: "" },
          status_transitions: {},
          parent: { subscription_details: { subscription: "sub_live" } },
        },
      },
    });
  }

  function stubSubscription(subscription: Partial<Stripe.Subscription>) {
    return vi
      .spyOn(stripe.write.subscriptions, "retrieve")
      .mockResolvedValue(fromPartial(subscription));
  }

  it("leaves the workspace active while an upgrade awaits 3D Secure", async () => {
    workspace = await seedWorkspace({ status: "active" });
    const retrieve = stubSubscription({
      pending_update: fromPartial({ expires_at: 1 }),
      latest_invoice: fromPartial({ id: workspace.invoiceId, status: "open" }),
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(retrieve).toHaveBeenCalledWith("sub_live", {
      expand: ["latest_invoice"],
    });
    expect(await statusOf(workspace.tenantId)).toBe("active");
    expect(notifiedUserIds()).toEqual([]);
  });

  it("ignores the failed attempt of an upgrade paid since", async () => {
    workspace = await seedWorkspace({ status: "active" });
    stubSubscription({
      pending_update: null,
      latest_invoice: fromPartial({ id: workspace.invoiceId, status: "paid" }),
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(await statusOf(workspace.tenantId)).toBe("active");
  });

  it("dunns an unpaid subscription update that applied regardless", async () => {
    workspace = await seedWorkspace({ status: "active" });
    stubSubscription({
      pending_update: null,
      latest_invoice: fromPartial({ id: workspace.invoiceId, status: "open" }),
    });

    await handleInvoicePaymentFailed(failure("subscription_update"));

    expect(await statusOf(workspace.tenantId)).toBe("past_due");
  });

  it("moves an active workspace to past due", async () => {
    workspace = await seedWorkspace({ status: "active" });
    const retrieve = stubSubscription({});

    await handleInvoicePaymentFailed(failure());

    expect(await statusOf(workspace.tenantId)).toBe("past_due");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each(["suspended", "cancelled"] as const)(
    "keeps a %s workspace as it is when a retry fails",
    async (status) => {
      workspace = await seedWorkspace({ status });

      await handleInvoicePaymentFailed(failure());

      expect(await statusOf(workspace.tenantId)).toBe(status);
    },
  );
});
