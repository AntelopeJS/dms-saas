import path from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import type * as coreInternalModule from "@antelopejs/interface-core/internal";
import type * as declarationModule from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import { describe, expect, it, vi } from "vitest";
import type * as implementationModule from "../src/implementations/dms-saas/workspace-lifecycle";

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn() },
}));

const CONSUMER_NAME = "cloud.consumer";

interface LifecycleModules {
  coreInternal: typeof coreInternalModule;
  declaration: typeof declarationModule;
  implementation: typeof implementationModule;
}

async function loadModules(): Promise<LifecycleModules> {
  vi.resetModules();
  return {
    coreInternal: await import("@antelopejs/interface-core/internal"),
    declaration:
      await import("@antelopejs/interface-dms-saas/workspace-lifecycle"),
    implementation:
      await import("../src/implementations/dms-saas/workspace-lifecycle"),
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
): declarationModule.WorkspaceLifecycleConsumerRegistration {
  return modules.declaration.RegisterWorkspaceLifecycleConsumer({
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
  return (await consumer?.consume(undefined as never))?.receiptId;
}

describe("RegisterWorkspaceLifecycleConsumer", () => {
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

describe("UnregisterWorkspaceLifecycleConsumer", () => {
  it("removes an attached consumer through its registration handle", async () => {
    const modules = await loadAttachedModules();
    const registration = register(modules, CONSUMER_NAME);

    registration.unregister();

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("removes a buffered consumer before dms-saas attaches", async () => {
    const modules = await loadModules();
    register(modules, CONSUMER_NAME);

    modules.declaration.UnregisterWorkspaceLifecycleConsumer(CONSUMER_NAME);
    attach(modules);

    expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual([]);
  });

  it("removes consumers owned by an unloaded module", async () => {
    const modules = await loadAttachedModules();
    const originalFolders = modules.coreInternal.internal.moduleByFolder;
    modules.coreInternal.internal.moduleByFolder = [
      {
        dir: path.join(
          process.cwd(),
          "packages/interface-dms-saas/src/interfaces",
        ),
        id: "dms-saas",
        isImplementor: true,
      },
      { dir: path.join(process.cwd(), "test"), id: "cloud" },
    ];
    try {
      register(modules, CONSUMER_NAME);

      modules.declaration.internal.RegisterWorkspaceLifecycleConsumer.unregisterModule(
        "cloud",
      );

      expect(modules.implementation.getWorkspaceLifecycleConsumers()).toEqual(
        [],
      );
    } finally {
      modules.coreInternal.internal.moduleByFolder = originalFolders;
    }
  });
});
