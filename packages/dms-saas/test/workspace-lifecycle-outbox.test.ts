import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TenantLifecycleConsumer,
  TenantLifecycleConsumerRegistration,
  TenantLifecycleMessage,
  TenantLifecycleReceipt,
  TenantLifecycleTransition,
} from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import * as tenantLifecycleImplementation from "../src/implementations/dms-saas/tenant-lifecycle";
import * as tenantLifecycleInterface from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { RegisterTenantLifecycleConsumer } from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { LifecycleDeliveryModel } from "../src/operator-actions/db/lifecycle-delivery.model";
import {
  beginWorkspaceCreation,
  cancelWorkspaceCreated,
  deliverWorkspaceCreated,
  dispatchWorkspaceLifecycle,
  prepareWorkspaceCreated,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-lifecycle-outbox");
const stripe = useSuiteStripe();
const logs = captureLogs();

ImplementInterface(tenantLifecycleInterface, tenantLifecycleImplementation);

const registrations: TenantLifecycleConsumerRegistration[] = [];
let invoiceStatus = "open";

async function deliveries() {
  return GetModel(LifecycleDeliveryModel).getAll();
}

async function setTenantExists(exists: boolean): Promise<void> {
  const now = new Date();
  const tenants = GetModel(TenantModel);
  await tenants.delete("tenant-123");
  if (exists)
    await tenants.insert({
      _id: "tenant-123",
      name: "tenant-123",
      createdAt: now,
      updatedAt: now,
    });
}

/** Makes the next insert of the consumer's delivery fail, as a lost connection would. */
function failNextInsertOf(consumer: string): void {
  const model = GetModel(LifecycleDeliveryModel);
  const insert = model.insert.bind(model);
  let isPending = true;
  vi.spyOn(model, "insert").mockImplementation(async (row, options) => {
    if (isPending && !Array.isArray(row) && row.consumer === consumer) {
      isPending = false;
      throw new Error("insert connection lost");
    }
    return insert(row, options);
  });
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

function registerConsumer(
  name: string,
  consume: TenantLifecycleConsumer["consume"],
  transitions: readonly TenantLifecycleTransition[],
): TenantLifecycleConsumerRegistration {
  const registration = RegisterTenantLifecycleConsumer({
    name,
    consume,
    transitions,
  });
  registrations.push(registration);
  return registration;
}

beforeEach(async () => {
  for (const registration of registrations.splice(0)) registration.unregister();
  invoiceStatus = "open";
  vi.spyOn(stripe.write.invoices, "retrieve").mockImplementation(async () =>
    fromPartial({ status: invoiceStatus }),
  );
  for (const { _id } of await deliveries()) {
    await GetModel(LifecycleDeliveryModel).delete(_id);
  }
  await setTenantExists(true);
});

describe("workspace lifecycle outbox", () => {
  it("preserves guarded provenance after receipt loss and rejects reassignment", async () => {
    const consume = vi.fn(async (_message: TenantLifecycleMessage) => ({
      receiptId: "receipt",
    }));
    registerConsumer("guarded.consumer", consume, ["reactivation_requested"]);
    const message: TenantLifecycleMessage = {
      tenantId: "tenant-123",
      operationId: "delivery",
      planChangeOperationId: "downgrade-root",
      transition: "reactivation_requested",
      requestedAt: new Date(),
    };
    failNextReceiptOf("guarded.consumer");
    await expect(dispatchWorkspaceLifecycle(message)).rejects.toThrow();
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume.mock.calls[0][0]).toEqual(message);
    expect(consume.mock.calls[1][0]).toEqual(message);
    await expect(
      dispatchWorkspaceLifecycle({
        ...message,
        planChangeOperationId: "different-root",
      }),
    ).rejects.toThrow("conflicting content");
  });

  it("delivers once across concurrent reconcilers and skips a durable receipt on later reconciliation", async () => {
    const effects = new Set<string>();
    const consume = vi.fn(
      async (message: tenantLifecycleInterface.TenantLifecycleMessage) => {
        effects.add(message.operationId);
        return { receiptId: "created" };
      },
    );
    registerConsumer("created.consumer", consume, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    await Promise.all([
      reconcileWorkspaceLifecycleDeliveries(),
      reconcileWorkspaceLifecycleDeliveries(),
      reconcileWorkspaceLifecycleDeliveries(),
    ]);
    expect(consume).toHaveBeenCalledOnce();
    expect(effects.size).toBe(1);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledOnce();
  });

  it("recovers partial fan-out without losing a consumer", async () => {
    const alpha = vi.fn(async () => ({ receiptId: "alpha" }));
    const beta = vi.fn(async () => ({ receiptId: "beta" }));
    registerConsumer("alpha.created", alpha, ["created"]);
    registerConsumer("beta.created", beta, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    failNextInsertOf("beta.created");
    await deliverWorkspaceCreated("tenant-123");
    expect(logs.at("ERROR")).toEqual([
      [
        "[dms-saas:lifecycle] creation delivery for tenant-123 deferred",
        expect.objectContaining({ message: "insert connection lost" }),
      ],
    ]);
    expect(alpha).not.toHaveBeenCalled();
    expect(beta).not.toHaveBeenCalled();
    await reconcileWorkspaceLifecycleDeliveries();
    expect(alpha).toHaveBeenCalledOnce();
    expect(beta).toHaveBeenCalledOnce();
  });

  it("replays a lost receipt with the same operation ID so consumers can deduplicate effects", async () => {
    const effects = new Set<string>();
    const consume = vi.fn(
      async (message: tenantLifecycleInterface.TenantLifecycleMessage) => {
        effects.add(message.operationId);
        return { receiptId: message.operationId };
      },
    );
    registerConsumer("created.consumer", consume, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    failNextReceiptOf("created.consumer");
    await deliverWorkspaceCreated("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledTimes(2);
    expect(effects.size).toBe(1);
    expect(consume.mock.calls[0][0]).toEqual(consume.mock.calls[1][0]);
  });

  it("closes inventory eligibility before tenant insertion and never reopens a rollback tombstone", async () => {
    const { IsTenantProvisioningCommitted } = tenantLifecycleInterface;
    expect(await IsTenantProvisioningCommitted("legacy")).toBe(true);
    await setTenantExists(false);
    await beginWorkspaceCreation("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(await IsTenantProvisioningCommitted("tenant-123")).toBe(false);
    await setTenantExists(true);
    await prepareWorkspaceCreated("tenant-123", "invoice-123");
    expect(await IsTenantProvisioningCommitted("tenant-123")).toBe(false);
    await cancelWorkspaceCreated("tenant-123");
    expect(await IsTenantProvisioningCommitted("tenant-123")).toBe(false);
    await expect(prepareWorkspaceCreated("tenant-123", null)).rejects.toThrow(
      "state changed",
    );
  });

  it("recovers the payment-to-delivery crash gap without notifying suspension consumers", async () => {
    const suspension = vi.fn(async () => ({ receiptId: "suspended" }));
    const created = vi.fn(async () => ({ receiptId: "created" }));
    registerConsumer("suspension.consumer", suspension, ["suspended"]);
    registerConsumer("created.consumer", created, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", "invoice-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).not.toHaveBeenCalled();

    invoiceStatus = "paid";
    await reconcileWorkspaceLifecycleDeliveries();
    await beginWorkspaceCreation("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(
      await tenantLifecycleInterface.IsTenantProvisioningCommitted(
        "tenant-123",
      ),
    ).toBe(true);
    expect(suspension).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        tenantId: "tenant-123",
        operationId: "workspace-created:tenant-123",
        transition: "created",
      }),
    );
    expect(await deliveries()).toHaveLength(2);
  });

  it("commits no-invoice workspaces without consulting payment and retries failed consumers", async () => {
    const created = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ receiptId: "created" });
    registerConsumer("created.consumer", created, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    await deliverWorkspaceCreated("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).toHaveBeenCalledTimes(2);
    expect(created.mock.calls[0][0]).toEqual(created.mock.calls[1][0]);
  });

  it("does not deliver a cancelled creation even if its invoice later appears paid", async () => {
    const created = vi.fn(async () => ({ receiptId: "created" }));
    registerConsumer("created.consumer", created, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", "invoice-123");
    await cancelWorkspaceCreated("tenant-123");
    invoiceStatus = "paid";
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).not.toHaveBeenCalled();
  });

  it("discards creation delivery for a deleted tenant", async () => {
    const created = vi.fn(async () => ({ receiptId: "created" }));
    registerConsumer("created.consumer", created, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    await setTenantExists(false);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).not.toHaveBeenCalled();
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        status: "succeeded",
        receiptId: "deleted:workspace-created:tenant-123",
      }),
    ]);
  });

  it("does not invoke a downgraded consumer on a previously queued created message", async () => {
    registerConsumer(
      "created.consumer",
      async () => {
        throw new Error("offline");
      },
      ["created"],
    );
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    await deliverWorkspaceCreated("tenant-123");
    const downgraded = vi.fn(async () => ({ receiptId: "suspended" }));
    registerConsumer("created.consumer", downgraded, ["suspended"]);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(downgraded).not.toHaveBeenCalled();
  });

  it("persists receipts and skips successful consumers during retry", async () => {
    const firstConsumer = vi.fn(async () => ({ receiptId: "alpha-receipt" }));
    const secondConsumer = vi
      .fn<() => Promise<TenantLifecycleReceipt>>()
      .mockRejectedValueOnce(new Error("wake failed"))
      .mockResolvedValue({ receiptId: "beta-receipt" });
    registerConsumer("alpha.consumer", firstConsumer, [
      "reactivation_requested",
    ]);
    registerConsumer("beta.consumer", secondConsumer, [
      "reactivation_requested",
    ]);
    const input = {
      tenantId: "tenant-123",
      operationId: "lifecycle-operation-123",
      transition: "reactivation_requested" as const,
      requestedAt: new Date("2026-08-28T12:00:00.000Z"),
    };

    await expect(dispatchWorkspaceLifecycle(input)).rejects.toThrow(
      "wake failed",
    );
    expect(firstConsumer).toHaveBeenCalledOnce();
    expect(firstConsumer).toHaveBeenCalledWith({
      tenantId: input.tenantId,
      operationId: input.operationId,
      transition: input.transition,
      requestedAt: input.requestedAt,
    });
    expect(secondConsumer).toHaveBeenCalledOnce();
    expect(
      (await deliveries())
        .map((delivery) => ({
          consumer: delivery.consumer,
          status: delivery.status,
          receiptId: delivery.receiptId,
        }))
        .toSorted((left, right) => left.consumer.localeCompare(right.consumer)),
    ).toEqual([
      {
        consumer: "alpha.consumer",
        status: "succeeded",
        receiptId: "alpha-receipt",
      },
      { consumer: "beta.consumer", status: "failed", receiptId: null },
    ]);

    await expect(dispatchWorkspaceLifecycle(input)).resolves.toBeUndefined();
    expect(firstConsumer).toHaveBeenCalledOnce();
    expect(secondConsumer).toHaveBeenCalledTimes(2);
    expect(await deliveries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumer: "beta.consumer",
          status: "succeeded",
          attemptCount: 2,
          receiptId: "beta-receipt",
        }),
      ]),
    );
  });

  it("keeps an undelivered required consumer blocking after unregister", async () => {
    const registration = registerConsumer(
      "required.consumer",
      async () => {
        throw new Error("consumer failed");
      },
      ["reactivation_requested"],
    );
    const input = {
      tenantId: "tenant-123",
      operationId: "missing-consumer-operation",
      transition: "reactivation_requested" as const,
      requestedAt: new Date("2026-08-28T12:00:00.000Z"),
    };

    await expect(dispatchWorkspaceLifecycle(input)).rejects.toThrow(
      "consumer failed",
    );
    registration.unregister();

    await expect(dispatchWorkspaceLifecycle(input)).rejects.toThrow(
      "Workspace lifecycle consumer is unavailable",
    );
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        consumer: "required.consumer",
        status: "failed",
        attemptCount: 1,
      }),
    ]);
  });

  it("rejects invalid consumer receipt effective times", async () => {
    registerConsumer(
      "invalid.receipt",
      async () => ({
        receiptId: "receipt-123",
        effectiveAt: new Date("invalid"),
      }),
      ["suspended"],
    );

    await expect(
      dispatchWorkspaceLifecycle({
        tenantId: "tenant-123",
        operationId: "invalid-receipt-operation",
        transition: "suspended",
        requestedAt: new Date("2026-08-28T12:00:00.000Z"),
      }),
    ).rejects.toThrow("Invalid workspace lifecycle receipt effective time");
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: "failed", attemptCount: 1 }),
    ]);
  });
});
