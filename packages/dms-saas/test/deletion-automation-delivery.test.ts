import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  emitAutomationEvent,
  registerAutomationNodes,
} from "../src/automation";
import { TenantBillingStateModel } from "../src/db";
import { registerSaasHookListeners } from "../src/hooks/register";
import {
  armTrigger,
  implementAutomationCatalog,
  registeredTrigger,
} from "./helpers/automation";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase();
const catalog = implementAutomationCatalog();

beforeAll(registerSaasHookListeners);

describe("best-effort automation emission", () => {
  it("contains synchronous and asynchronous listener failures without skipping later listeners", async () => {
    await registerAutomationNodes();
    const trigger = registeredTrigger(catalog, "saas.trial-ending");
    const synchronousFailure = vi.fn(() => {
      throw new Error("synchronous listener failure");
    });
    const asynchronousFailure = () =>
      Promise.reject(new Error("queue unavailable"));
    const delivered = vi.fn();
    const handles = await Promise.all(
      [synchronousFailure, asynchronousFailure, delivered].map((listener) =>
        trigger.activate({}, listener),
      ),
    );
    const payload = {
      tenantId: "tenant-a",
      deliveryId: "delivery-a",
      trialEndsAt: null,
      at: "2026-09-14T00:00:00Z",
    };
    try {
      expect(() =>
        emitAutomationEvent("saas.trial-ending", payload),
      ).not.toThrow();
      await setImmediate();
      expect(delivered).toHaveBeenCalledExactlyOnceWith(payload);
    } finally {
      await Promise.all(handles.map((handle) => trigger.deactivate(handle)));
    }
  });
});

describe("saas.tenant-deleted from the deletion hook", () => {
  async function deleteTenant(tenantId: string, operationId: string) {
    await ExecuteHooks(Hook.TENANT_DELETED, tenantId, { operationId });
  }

  it("resolves without waiting on the procedures it starts", async () => {
    await registerAutomationNodes();
    const trigger = registeredTrigger(catalog, "saas.tenant-deleted");
    const handle = await trigger.activate(
      {},
      () => new Promise(() => undefined),
    );
    onTestFinished(() => trigger.deactivate(handle));

    await expect(
      deleteTenant(randomUUID(), "delete-operation-a"),
    ).resolves.toBeUndefined();
  });

  it("does not fail the deletion when a procedure fails", async () => {
    await registerAutomationNodes();
    const trigger = registeredTrigger(catalog, "saas.tenant-deleted");
    const handle = await trigger.activate({}, () =>
      Promise.reject(new Error("queue unavailable")),
    );
    onTestFinished(() => trigger.deactivate(handle));

    await expect(
      deleteTenant(randomUUID(), "delete-operation-b"),
    ).resolves.toBeUndefined();
  });

  it("hands a resumed deletion the same deliveryId", async () => {
    await registerAutomationNodes();
    const payloads = await armTrigger(catalog, "saas.tenant-deleted");
    const tenantId = randomUUID();

    await deleteTenant(tenantId, "delete-operation-c");
    await deleteTenant(tenantId, "delete-operation-c");

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId,
        deliveryId: "delete-operation-c",
        operationId: "delete-operation-c",
      }),
      expect.objectContaining({ tenantId, deliveryId: "delete-operation-c" }),
    ]);
  });

  it("still rejects a deletion whose billing tombstone is missing", async () => {
    vi.spyOn(
      GetModel(TenantBillingStateModel),
      "findByTenant",
    ).mockResolvedValue(undefined);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });

    await expect(
      deleteTenant(randomUUID(), "delete-operation-d"),
    ).rejects.toThrow("Tenant deletion tombstone is missing");
  });
});
