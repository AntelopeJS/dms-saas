import { fromPartial } from "@total-typescript/shoehorn";
import {
  ImplementInterface,
  RunWithResponsibleModule,
} from "@antelopejs/interface-core";
import type * as declarationModule from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { describe, expect, it, vi } from "vitest";
import type * as implementationModule from "../src/implementations/dms-saas/tenant-lifecycle";

const CONSUMER_NAME = "cloud.consumer";

interface LifecycleModules {
  declaration: typeof declarationModule;
  implementation: typeof implementationModule;
}

async function loadModules(): Promise<LifecycleModules> {
  vi.resetModules();
  return {
    declaration:
      await import("@antelopejs/interface-dms-saas/tenant-lifecycle"),
    implementation:
      await import("../src/implementations/dms-saas/tenant-lifecycle"),
  };
}

function attach(modules: LifecycleModules): void {
  ImplementInterface(modules.declaration, modules.implementation);
}

async function loadAttachedModules(): Promise<LifecycleModules> {
  const modules = await loadModules();
  attach(modules);
  return modules;
}

function register(
  modules: LifecycleModules,
  name: string,
  receiptId = "receipt",
): declarationModule.TenantLifecycleConsumerRegistration {
  return modules.declaration.RegisterTenantLifecycleConsumer({
    name,
    transitions: ["suspended", "reactivation_requested"],
    consume: async () => ({ receiptId }),
  });
}

async function receiptId(
  modules: LifecycleModules,
  name: string,
): Promise<string | undefined> {
  const consumer = modules.implementation.getWorkspaceLifecycleConsumer(name);
  return (
    await consumer?.consume(
      fromPartial<Parameters<typeof consumer.consume>[0]>({}),
    )
  )?.receiptId;
}

describe("RegisterTenantLifecycleConsumer", () => {
  it("holds registrations made before dms-saas attaches", async () => {
    const modules = await loadModules();

    register(modules, CONSUMER_NAME);

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("replays held registrations once dms-saas attaches", async () => {
    const modules = await loadModules();
    register(modules, CONSUMER_NAME);

    attach(modules);

    expect(await receiptId(modules, CONSUMER_NAME)).toBe("receipt");
  });

  it("rejects invalid consumer names before registration", async () => {
    const modules = await loadAttachedModules();

    expect(() => register(modules, "invalid name")).toThrow(
      "Invalid workspace lifecycle consumer name",
    );
    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("replaces an attached consumer with the same name", async () => {
    const modules = await loadAttachedModules();
    register(modules, CONSUMER_NAME, "first");

    register(modules, CONSUMER_NAME, "second");

    expect(await receiptId(modules, CONSUMER_NAME)).toBe("second");
  });

  it("replays only the last buffered consumer with the same name", async () => {
    const modules = await loadModules();
    register(modules, CONSUMER_NAME, "first");
    register(modules, CONSUMER_NAME, "second");

    attach(modules);

    expect(await receiptId(modules, CONSUMER_NAME)).toBe("second");
  });
});

describe("UnregisterTenantLifecycleConsumer", () => {
  it("removes an attached consumer through its registration handle", async () => {
    const modules = await loadAttachedModules();
    const registration = register(modules, CONSUMER_NAME);

    registration.unregister();

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("removes a buffered consumer before dms-saas attaches", async () => {
    const modules = await loadModules();
    register(modules, CONSUMER_NAME);

    modules.declaration.UnregisterTenantLifecycleConsumer(CONSUMER_NAME);
    attach(modules);

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("removes consumers owned by an unloaded module", async () => {
    const modules = await loadAttachedModules();
    RunWithResponsibleModule("cloud", () => register(modules, CONSUMER_NAME));

    modules.declaration.internal.RegisterTenantLifecycleConsumer.unregisterModule(
      "cloud",
    );

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });
});
