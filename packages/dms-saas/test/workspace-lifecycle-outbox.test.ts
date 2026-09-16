import { ImplementInterface } from "@antelopejs/interface-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceLifecycleConsumer,
  WorkspaceLifecycleConsumerRegistration,
  WorkspaceLifecycleReceipt,
  WorkspaceLifecycleTransition,
} from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import type { WorkspaceProvisioningState } from "../src/operator-actions/db/lifecycle-delivery.table";

interface Delivery {
  _id: string;
  operationId: string;
  tenantId: string;
  consumer: string;
  transition: WorkspaceLifecycleTransition;
  provisioningInvoiceId: string | null;
  provisioningState: WorkspaceProvisioningState | null;
  status: "pending" | "succeeded" | "failed";
  attemptCount: number;
  revision: string;
  receiptId: string | null;
  acceptedAt: Date | null;
  effectiveAt: Date | null;
  lastErrorCode: string | null;
  requestedAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

interface NamedModel {
  name: string;
}

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  deliveries: new Map<string, unknown>(),
  invoiceStatus: "open",
  tenantExists: true,
  failInsertConsumer: "",
  failReceiptConsumer: "",
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

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn() },
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: async () => ({ status: harness.invoiceStatus }) },
  }),
}));

import * as workspaceLifecycleImplementation from "../src/implementations/dms-saas/workspace-lifecycle";
import * as workspaceLifecycleInterface from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import { RegisterWorkspaceLifecycleConsumer } from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import {
  beginWorkspaceCreation,
  cancelWorkspaceCreated,
  deliverWorkspaceCreated,
  dispatchWorkspaceLifecycle,
  prepareWorkspaceCreated,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";

ImplementInterface(
  workspaceLifecycleInterface,
  workspaceLifecycleImplementation,
);

const registrations: WorkspaceLifecycleConsumerRegistration[] = [];

function currentDelivery(id: string): Delivery | undefined {
  return harness.deliveries.get(id) as Delivery | undefined;
}

function updatePending(id: string, update: Partial<Delivery>): void {
  const delivery = currentDelivery(id);
  if (!delivery || delivery.status === "succeeded") return;
  Object.assign(delivery, update, { attemptCount: delivery.attemptCount + 1 });
}

function lifecycleDeliveryModel(): object {
  return {
    insert: async (delivery: Delivery) => {
      if (harness.failInsertConsumer === delivery.consumer) {
        harness.failInsertConsumer = "";
        throw new Error("insert connection lost");
      }
      if (harness.deliveries.has(delivery._id)) throw new Error("duplicate");
      harness.deliveries.set(delivery._id, { ...delivery });
    },
    get: async (id: string) => currentDelivery(id),
    transitionProvisioning: async (
      id: string,
      expected: WorkspaceProvisioningState,
      next: WorkspaceProvisioningState,
      invoiceId?: string | null,
    ) => {
      const row = currentDelivery(id);
      if (row?.provisioningState === next) return;
      if (!row || row.provisioningState !== expected)
        throw new Error("Workspace provisioning state changed");
      row.provisioningState = next;
      if (invoiceId !== undefined) row.provisioningInvoiceId = invoiceId;
      if (next === "cancelled") Object.assign(row, { status: "succeeded" });
    },
    delete: async (id: string) => harness.deliveries.delete(id),
    findReplayable: async () =>
      [...harness.deliveries.values()].filter(
        (value) => (value as Delivery).status !== "succeeded",
      ),
    findByOperation: async (operationId: string) =>
      [...harness.deliveries.values()].filter(
        (value) => (value as Delivery).operationId === operationId,
      ),
    markSucceeded: async (
      delivery: Delivery,
      receipt: WorkspaceLifecycleReceipt,
    ) => {
      if (harness.failReceiptConsumer === delivery.consumer) {
        harness.failReceiptConsumer = "";
        throw new Error("receipt connection lost");
      }
      updatePending(delivery._id, {
        status: "succeeded",
        receiptId: receipt.receiptId,
        effectiveAt: receipt.effectiveAt ?? new Date(),
      });
    },
    markFailed: async (delivery: Delivery) => {
      updatePending(delivery._id, {
        status: "failed",
        lastErrorCode: "saas.errors.lifecycle.consumer_failed",
      });
    },
  };
}

function registerConsumer(
  name: string,
  consume: WorkspaceLifecycleConsumer["consume"],
  transitions: readonly WorkspaceLifecycleTransition[],
): WorkspaceLifecycleConsumerRegistration {
  const registration = RegisterWorkspaceLifecycleConsumer({
    name,
    consume,
    transitions,
  });
  registrations.push(registration);
  return registration;
}

beforeEach(() => {
  for (const registration of registrations.splice(0)) registration.unregister();
  harness.models.clear();
  harness.deliveries.clear();
  harness.invoiceStatus = "open";
  harness.tenantExists = true;
  harness.failInsertConsumer = "";
  harness.failReceiptConsumer = "";
  harness.models.set("LifecycleDeliveryModel", lifecycleDeliveryModel());
  harness.models.set("TenantModel", {
    get: async () => (harness.tenantExists ? { _id: "tenant-123" } : undefined),
  });
});

describe("workspace lifecycle outbox", () => {
  it("replays the same identity concurrently and skips a durable receipt on later reconciliation", async () => {
    const effects = new Set<string>();
    const consume = vi.fn(
      async (
        message: workspaceLifecycleInterface.WorkspaceLifecycleMessage,
      ) => {
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
    expect(consume).toHaveBeenCalledTimes(3);
    expect(effects.size).toBe(1);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledTimes(3);
  });

  it("recovers partial fan-out without losing a consumer", async () => {
    const alpha = vi.fn(async () => ({ receiptId: "alpha" }));
    const beta = vi.fn(async () => ({ receiptId: "beta" }));
    registerConsumer("alpha.created", alpha, ["created"]);
    registerConsumer("beta.created", beta, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    harness.failInsertConsumer = "beta.created";
    await deliverWorkspaceCreated("tenant-123");
    expect(alpha).not.toHaveBeenCalled();
    expect(beta).not.toHaveBeenCalled();
    await reconcileWorkspaceLifecycleDeliveries();
    expect(alpha).toHaveBeenCalledOnce();
    expect(beta).toHaveBeenCalledOnce();
  });

  it("replays a lost receipt with the same operation ID so consumers can deduplicate effects", async () => {
    const effects = new Set<string>();
    const consume = vi.fn(
      async (
        message: workspaceLifecycleInterface.WorkspaceLifecycleMessage,
      ) => {
        effects.add(message.operationId);
        return { receiptId: message.operationId };
      },
    );
    registerConsumer("created.consumer", consume, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    harness.failReceiptConsumer = "created.consumer";
    await deliverWorkspaceCreated("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledTimes(2);
    expect(effects.size).toBe(1);
    expect(consume.mock.calls[0][0]).toEqual(consume.mock.calls[1][0]);
  });

  it("closes inventory eligibility before tenant insertion and never reopens a rollback tombstone", async () => {
    const { IsWorkspaceProvisioningCommitted } = workspaceLifecycleInterface;
    expect(await IsWorkspaceProvisioningCommitted("legacy")).toBe(true);
    harness.tenantExists = false;
    await beginWorkspaceCreation("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(await IsWorkspaceProvisioningCommitted("tenant-123")).toBe(false);
    harness.tenantExists = true;
    await prepareWorkspaceCreated("tenant-123", "invoice-123");
    expect(await IsWorkspaceProvisioningCommitted("tenant-123")).toBe(false);
    await cancelWorkspaceCreated("tenant-123");
    expect(await IsWorkspaceProvisioningCommitted("tenant-123")).toBe(false);
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

    harness.invoiceStatus = "paid";
    await reconcileWorkspaceLifecycleDeliveries();
    await beginWorkspaceCreation("tenant-123");
    await reconcileWorkspaceLifecycleDeliveries();
    expect(
      await workspaceLifecycleInterface.IsWorkspaceProvisioningCommitted(
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
    expect(harness.deliveries.size).toBe(2);
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
    harness.invoiceStatus = "paid";
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).not.toHaveBeenCalled();
  });

  it("discards creation delivery for a deleted tenant", async () => {
    const created = vi.fn(async () => ({ receiptId: "created" }));
    registerConsumer("created.consumer", created, ["created"]);
    await beginWorkspaceCreation("tenant-123");
    await prepareWorkspaceCreated("tenant-123", null);
    harness.tenantExists = false;
    await reconcileWorkspaceLifecycleDeliveries();
    expect(created).not.toHaveBeenCalled();
    expect([...harness.deliveries.values()]).toEqual([
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
      .fn<() => Promise<WorkspaceLifecycleReceipt>>()
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
      [...harness.deliveries.values()].map((value) => ({
        consumer: (value as Delivery).consumer,
        status: (value as Delivery).status,
        receiptId: (value as Delivery).receiptId,
      })),
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
    expect([...harness.deliveries.values()]).toEqual(
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
    expect([...harness.deliveries.values()]).toEqual([
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
    expect([...harness.deliveries.values()]).toEqual([
      expect.objectContaining({ status: "failed", attemptCount: 1 }),
    ]);
  });
});
