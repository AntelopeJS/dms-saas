import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PluginSetup = () => void;

interface RegisteredDataType {
  id: string;
}

interface PluginOptions {
  clientOnly?: boolean;
}

interface PluginRegistration {
  plugin: unknown;
  options?: PluginOptions;
}

describe("catalogue cell formatters", () => {
  const dataTypes: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    dataTypes.length = 0;
    vi.stubGlobal("defineDmsPlugin", (setup: PluginSetup) => setup);
    vi.stubGlobal("useDataTypes", () => ({
      registerDataType: (dataType: RegisteredDataType) =>
        dataTypes.push(dataType.id),
    }));
    vi.stubGlobal("useDmsApp", () => ({
      $i18n: { t: (key: string) => key },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The plan and feature tables draw money in each row's currency, member
  // caps and feature usage in words: their cells need these data types.
  it("registers the cell formatters the catalogue tables use", async () => {
    const plugin =
      await import("../frontend-vue/app/plugins/catalog-data-types");
    (plugin.default as unknown as PluginSetup)();

    expect(dataTypes.sort()).toEqual([
      "saas:feature-usage",
      "saas:plan-member-cap",
      "saas:plan-money",
    ]);
  });

  // The cells are drawn during server rendering too, so the plugin must not
  // be limited to the browser.
  it("is registered by a universal plugin", async () => {
    const pluginRegistrations: PluginRegistration[] = [];
    const [frontendModule, catalogDataTypes] = await Promise.all([
      import("../frontend-vue/dms.frontend"),
      import("../frontend-vue/app/plugins/catalog-data-types"),
    ]);
    frontendModule.default.setup({
      registerComponent: () => undefined,
      registerPage: () => undefined,
      registerAccessRedirect: () => undefined,
      registerPlugin: (plugin: unknown, options?: PluginOptions) =>
        pluginRegistrations.push({ plugin, options }),
    } as never);

    const registration = pluginRegistrations.find(
      ({ plugin }) => plugin === catalogDataTypes.default,
    );
    expect(registration).toBeDefined();
    expect(registration?.options?.clientOnly).not.toBe(true);
  });
});
