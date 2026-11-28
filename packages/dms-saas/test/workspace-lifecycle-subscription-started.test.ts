import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import type {
  TenantLifecycleConsumer,
  TenantLifecycleConsumerRegistration,
  TenantLifecycleTransition,
} from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import * as tenantLifecycleInterface from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { RegisterTenantLifecycleConsumer } from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { TenantSubscriptionModel } from "../src/db";
import * as tenantLifecycleImplementation from "../src/implementations/dms-saas/tenant-lifecycle";
import { LifecycleDeliveryModel } from "../src/operator-actions/db/lifecycle-delivery.model";
import {
  beginWorkspaceCreation,
  deliverWorkspaceCreated,
  prepareWorkspaceCreated,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";
import { armTrigger, implementAutomationCatalog } from "./helpers/automation";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
const stripe = useSuiteStripe();
const logs = captureLogs();
const automation = implementAutomationCatalog();
await registerAutomationNodes();

ImplementInterface(tenantLifecycleInterface, tenantLifecycleImplementation);

const registrations: TenantLifecycleConsumerRegistration[] = [];
let invoiceStatus = "open";

function registerConsumer(
  name: string,
  consume: TenantLifecycleConsumer["consume"],
  transitions: readonly TenantLifecycleTransition[],
): void {
  registrations.push(
    RegisterTenantLifecycleConsumer({ name, consume, transitions }),
  );
}

/** Makes the next receipt write of the consumer's delivery fail, as a lost connection would. */
function failNextReceiptOf(consumer: string): void {
  const model = GetModel(LifecycleDeliveryModel);
  const markSucceeded = model.markSucceeded.bind(model);
  let isPending = true;
  vi.spyOn(model, "markSucceeded").mockImplementation(
    async (delivery, receipt) => {
      if (isPending && delivery.consumer === consumer) {
        isPending = false;
        throw new Error("receipt connection lost");
      }
      return markSucceeded(delivery, receipt);
    },
  );
}

beforeEach(async () => {
  for (const registration of registrations.splice(0)) registration.unregister();
  invoiceStatus = "open";
  vi.spyOn(stripe.write.invoices, "retrieve").mockImplementation(async () =>
    fromPartial({ status: invoiceStatus }),
  );
  for (const { _id } of await GetModel(LifecycleDeliveryModel).getAll())
    await GetModel(LifecycleDeliveryModel).delete(_id);
  const now = new Date();
  await GetModel(TenantModel).delete("tenant-123");
  await GetModel(TenantModel).insert({
    _id: "tenant-123",
    name: "tenant-123",
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscription-started from a provisioned workspace", () => {
  const SUBSCRIPTION_ID = "sub_provisioned";

  async function seedSubscription(
    status: "active" | "trialing",
    stripeSubscriptionId: string | null,
    completedCheckoutSessionId: string | null = null,
  ): Promise<void> {
    const model = GetModel(TenantSubscriptionModel, "tenant-123");
    await model.table.delete().run();
    await model.insert({
      _id: "tenant-123",
      planId: "paid",
      status,
      stripeCustomerId: "cus_provisioned",
      stripeSubscriptionId,
      completedCheckoutSessionId,
    });
  }

  async function provisionPaid(): Promise<void> {
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", "invoice-123");
    invoiceStatus = "paid";
    await reconcileWorkspaceLifecycleDeliveries();
  }

  it("fires once the first invoice of a carded workspace is paid", async () => {
    await seedSubscription("active", SUBSCRIPTION_ID);
    const payloads = await armTrigger(automation, "saas.subscription-started");

    await provisionPaid();
    await reconcileWorkspaceLifecycleDeliveries();

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: "tenant-123",
        deliveryId: `subscription-started:${SUBSCRIPTION_ID}`,
        source: "provisioning",
        planId: "paid",
        status: "active",
        stripeSubscriptionId: SUBSCRIPTION_ID,
        trialConsumptionRecorded: false,
      }),
    ]);
  });

  it("reports a trial as recorded", async () => {
    await seedSubscription("trialing", SUBSCRIPTION_ID);
    const payloads = await armTrigger(automation, "saas.subscription-started");

    await provisionPaid();

    expect(payloads).toEqual([
      expect.objectContaining({
        status: "trialing",
        trialConsumptionRecorded: true,
      }),
    ]);
  });

  it("does not fire while the first payment is declined", async () => {
    await seedSubscription("active", SUBSCRIPTION_ID);
    const payloads = await armTrigger(automation, "saas.subscription-started");
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", "invoice-123");

    await reconcileWorkspaceLifecycleDeliveries();

    expect(payloads).toEqual([]);
  });

  it("does not fire for a workspace with no Stripe subscription", async () => {
    await seedSubscription("active", null);
    const payloads = await armTrigger(automation, "saas.subscription-started");
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);

    await deliverWorkspaceCreated("tenant-123");

    expect(payloads).toEqual([]);
  });

  it("fires again with the same deliveryId when a lost receipt is replayed", async () => {
    await seedSubscription("active", SUBSCRIPTION_ID);
    const payloads = await armTrigger(automation, "saas.subscription-started");
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    failNextReceiptOf("$workspace-created");

    await deliverWorkspaceCreated("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();

    expect(payloads).toEqual([
      expect.objectContaining({
        deliveryId: `subscription-started:${SUBSCRIPTION_ID}`,
      }),
      expect.objectContaining({
        deliveryId: `subscription-started:${SUBSCRIPTION_ID}`,
      }),
    ]);
  });

  it("leaves a subscription a Checkout completed to the Checkout event", async () => {
    await seedSubscription("active", SUBSCRIPTION_ID, "cs_completed");
    const payloads = await armTrigger(automation, "saas.subscription-started");

    await provisionPaid();

    expect(payloads).toEqual([]);
  });

  it("delivers the creation once even when the event cannot be read", async () => {
    await seedSubscription("active", SUBSCRIPTION_ID);
    const created = vi.fn(async () => ({ receiptId: "created" }));
    registerConsumer("created.consumer", created, ["created"]);
    vi.spyOn(
      GetModel(TenantSubscriptionModel, "tenant-123"),
      "findOne",
    ).mockRejectedValue(new Error("subscriptions unavailable"));

    await provisionPaid();
    await reconcileWorkspaceLifecycleDeliveries();

    expect(created).toHaveBeenCalledOnce();
    expect(logs.at("ERROR")).toContainEqual([
      "[dms-saas:lifecycle] subscription-started for tenant-123 not handed to automation",
      expect.objectContaining({ message: "subscriptions unavailable" }),
    ]);
  });
});
