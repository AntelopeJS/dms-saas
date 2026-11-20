import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { TenantSubscriptionModel } from "../src/db";
import { handleSubscriptionDeleted } from "../src/stripe/webhook-handlers";
import { requestWorkspaceDeletion } from "../src/workspaces/deletion";
import { armTrigger, implementAutomationCatalog } from "./helpers/automation";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();

const WORKSPACE_DELETION_DELIVERY: unknown =
  expect.stringMatching(/^workspace-deletion:/);
const stripe = useSuiteStripe();
const automation = implementAutomationCatalog();
await registerAutomationNodes();

afterEach(() => {
  vi.restoreAllMocks();
});

interface DeletableWorkspace {
  tenantId: string;
  customerId: string;
}

async function seedWorkspace(
  stripeSubscriptionId: string | null,
): Promise<DeletableWorkspace> {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId,
  });
  return { tenantId, customerId };
}

function stripeDeletion(
  workspace: DeletableWorkspace,
  subscriptionId: string,
): Stripe.CustomerSubscriptionDeletedEvent {
  return fromPartial<Stripe.CustomerSubscriptionDeletedEvent>({
    id: `evt_${randomUUID()}`,
    type: "customer.subscription.deleted",
    data: { object: { id: subscriptionId, customer: workspace.customerId } },
  });
}

describe("saas.subscription-cancelled from a workspace deletion", () => {
  it("fires once for a workspace without a Stripe subscription", async () => {
    const workspace = await seedWorkspace(null);
    const payloads = await armTrigger(
      automation,
      "saas.subscription-cancelled",
    );

    await requestWorkspaceDeletion(workspace.tenantId, "owner");

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: workspace.tenantId,
        source: "workspace_deletion",
        stripeSubscriptionId: null,
        deliveryId: WORKSPACE_DELETION_DELIVERY,
      }),
    ]);
  });

  it("fires once for a paid workspace, and not again from the Stripe webhook", async () => {
    const workspace = await seedWorkspace("sub_paid");
    vi.spyOn(stripe.write.subscriptions, "cancel").mockResolvedValue(
      fromPartial({ id: "sub_paid", status: "canceled" }),
    );
    const payloads = await armTrigger(
      automation,
      "saas.subscription-cancelled",
    );

    await requestWorkspaceDeletion(workspace.tenantId, "owner");
    await handleSubscriptionDeleted(stripeDeletion(workspace, "sub_paid"));

    expect(payloads).toEqual([
      expect.objectContaining({
        source: "workspace_deletion",
        stripeSubscriptionId: "sub_paid",
      }),
    ]);
  });

  it("does not fire when Stripe refuses the cancellation", async () => {
    const workspace = await seedWorkspace("sub_refused");
    vi.spyOn(stripe.write.subscriptions, "cancel").mockRejectedValue(
      new Error("stripe unavailable"),
    );
    const payloads = await armTrigger(
      automation,
      "saas.subscription-cancelled",
    );

    await expect(
      requestWorkspaceDeletion(workspace.tenantId, "owner"),
    ).rejects.toThrow("stripe unavailable");

    expect(payloads).toEqual([]);
  });

  it("names Stripe as the source of a cancellation Stripe made", async () => {
    const workspace = await seedWorkspace("sub_stripe");
    const payloads = await armTrigger(
      automation,
      "saas.subscription-cancelled",
    );
    const event = stripeDeletion(workspace, "sub_stripe");

    await handleSubscriptionDeleted(event);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: workspace.tenantId,
        source: "stripe",
        stripeSubscriptionId: "sub_stripe",
        deliveryId: event.id,
      }),
    ]);
  });
});
