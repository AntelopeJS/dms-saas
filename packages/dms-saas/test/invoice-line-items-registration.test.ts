import { fromPartial } from "@total-typescript/shoehorn";
import { ImplementInterface } from "@antelopejs/interface-core";
import type * as declarationModule from "@antelopejs/interface-dms-saas/invoice-line-items";
import { describe, expect, it, vi } from "vitest";
import type * as implementationModule from "../src/implementations/dms-saas/invoice-line-items";

const PROVIDER_ID = "cloud";

interface LineItemsModules {
  declaration: typeof declarationModule;
  implementation: typeof implementationModule;
}

/**
 * Loads a fresh proxy and registry for one test: both are module state, and
 * attaching is one-way, so a shared graph would let one test's attach decide
 * whether the next one exercises the buffered or the attached path.
 */
async function loadModules(): Promise<LineItemsModules> {
  vi.resetModules();
  return {
    declaration:
      await import("@antelopejs/interface-dms-saas/invoice-line-items"),
    implementation:
      await import("../src/implementations/dms-saas/invoice-line-items"),
  };
}

function attach(modules: LineItemsModules): void {
  ImplementInterface(modules.declaration, modules.implementation);
}

async function loadAttachedModules(): Promise<LineItemsModules> {
  const modules = await loadModules();
  attach(modules);
  return modules;
}

function register(modules: LineItemsModules, id: string, marker = ""): void {
  modules.declaration.RegisterInvoiceLineItemsProvider({
    id,
    resolve: () => [{ key: marker, description: marker, amountCents: 1 }],
  });
}

function registeredIds(modules: LineItemsModules): string[] {
  return modules.implementation
    .getInvoiceLineItemsProviders()
    .map((provider) => provider.id);
}

function resolvedMarkers(modules: LineItemsModules): string[] {
  return modules.implementation
    .getInvoiceLineItemsProviders()
    .flatMap((provider) => {
      const lines = provider.resolve(
        fromPartial<Parameters<typeof provider.resolve>[0]>({}),
      );
      if (!Array.isArray(lines)) {
        throw new TypeError(`Provider ${provider.id} did not answer lines`);
      }
      return lines.map((line) => line.key);
    });
}

describe("RegisterInvoiceLineItemsProvider", () => {
  it("keeps providers in registration order", async () => {
    const modules = await loadAttachedModules();

    register(modules, PROVIDER_ID);
    register(modules, "analytics");

    expect(registeredIds(modules)).toEqual([PROVIDER_ID, "analytics"]);
  });

  it("refuses an id holding the namespace separator", async () => {
    const modules = await loadAttachedModules();

    expect(() => register(modules, "cloud:usage")).toThrow();
  });

  it("holds registrations made before dms-saas attaches", async () => {
    const modules = await loadModules();

    register(modules, PROVIDER_ID);

    expect(registeredIds(modules)).toEqual([]);
  });

  it("replays the held registrations once dms-saas attaches", async () => {
    const modules = await loadModules();
    register(modules, PROVIDER_ID);

    attach(modules);

    expect(registeredIds(modules)).toEqual([PROVIDER_ID]);
  });
});

describe("RegisterInvoiceLineItemsProvider on a taken id", () => {
  it("replaces the previous provider once attached", async () => {
    const modules = await loadAttachedModules();
    register(modules, PROVIDER_ID, "first");

    register(modules, PROVIDER_ID, "second");

    expect(registeredIds(modules)).toEqual([PROVIDER_ID]);
    expect(resolvedMarkers(modules)).toEqual(["second"]);
  });

  it("replaces the previous provider when held before the attach", async () => {
    const modules = await loadModules();
    register(modules, PROVIDER_ID, "first");
    register(modules, PROVIDER_ID, "second");

    attach(modules);

    expect(registeredIds(modules)).toEqual([PROVIDER_ID]);
    expect(resolvedMarkers(modules)).toEqual(["second"]);
  });
});

describe("UnregisterInvoiceLineItemsProvider", () => {
  it("drops the matching provider", async () => {
    const modules = await loadAttachedModules();
    register(modules, PROVIDER_ID);
    register(modules, "analytics");

    modules.declaration.UnregisterInvoiceLineItemsProvider(PROVIDER_ID);

    expect(registeredIds(modules)).toEqual(["analytics"]);
  });

  it("ignores an unknown id", async () => {
    const modules = await loadAttachedModules();
    register(modules, PROVIDER_ID);

    modules.declaration.UnregisterInvoiceLineItemsProvider("unknown");

    expect(registeredIds(modules)).toEqual([PROVIDER_ID]);
  });

  it("drops a provider held before dms-saas attaches", async () => {
    const modules = await loadModules();
    register(modules, PROVIDER_ID);

    modules.declaration.UnregisterInvoiceLineItemsProvider(PROVIDER_ID);
    attach(modules);

    expect(registeredIds(modules)).toEqual([]);
  });
});
