import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaasPlansController } from "../src/pages/platform/plans";

type PluginSetup = () => void;

interface RegisteredDisplay {
  id: string;
  component?: unknown;
}

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

const PLAN_CARDS_DISPLAY_ID = "saas:plan-cards";

const planCardsComponent = vi.hoisted(() => ({ name: "PlanCardsDisplay" }));

vi.mock("../frontend-vue/app/components/PlanCardsDisplay.vue", () => ({
  default: planCardsComponent,
}));

describe("plan cards display", () => {
  const registered: RegisteredDisplay[] = [];
  const dataTypes: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    registered.length = 0;
    dataTypes.length = 0;
    vi.stubGlobal("defineDmsPlugin", (setup: PluginSetup) => setup);
    vi.stubGlobal("registerTableViewDisplay", (display: RegisteredDisplay) =>
      registered.push(display),
    );
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

  it("registers the cards component under the module-prefixed id", async () => {
    const plugin =
      await import("../frontend-vue/app/plugins/plan-cards-display");
    (plugin.default as unknown as PluginSetup)();

    expect(registered).toEqual([
      expect.objectContaining({
        id: PLAN_CARDS_DISPLAY_ID,
        component: planCardsComponent,
      }),
    ]);
  });

  // The plan and feature tables draw money in each row's currency, member
  // caps and feature usage in words: their cells need these data types.
  it("registers the cell formatters the catalogue tables use", async () => {
    const plugin =
      await import("../frontend-vue/app/plugins/plan-cards-display");
    (plugin.default as unknown as PluginSetup)();

    expect(dataTypes.sort()).toEqual([
      "saas:feature-usage",
      "saas:plan-member-cap",
      "saas:plan-money",
    ]);
  });

  // DMS 0.4 reserves `cards` for its built-in display and refuses an
  // unprefixed module id, so the page must ask for the same prefixed id the
  // plugin registers.
  it("is the display the plans table offers and opens on", async () => {
    const { options } = await SaasPlansController.table.serialize();

    expect(options?.displays?.map((display) => display.id)).toEqual([
      PLAN_CARDS_DISPLAY_ID,
    ]);
    expect(options?.defaultDisplay).toBe(PLAN_CARDS_DISPLAY_ID);
  });

  // The display is resolved during server rendering too, so its plugin must
  // not be limited to the browser.
  it("is registered by a universal plugin", async () => {
    const pluginRegistrations: PluginRegistration[] = [];
    const [frontendModule, planCards] = await Promise.all([
      import("../frontend-vue/dms.frontend"),
      import("../frontend-vue/app/plugins/plan-cards-display"),
    ]);
    frontendModule.default.setup({
      registerComponent: () => undefined,
      registerPage: () => undefined,
      registerAccessRedirect: () => undefined,
      registerPlugin: (plugin: unknown, options?: PluginOptions) =>
        pluginRegistrations.push({ plugin, options }),
    } as never);

    const registration = pluginRegistrations.find(
      ({ plugin }) => plugin === planCards.default,
    );
    expect(registration).toBeDefined();
    expect(registration?.options?.clientOnly).not.toBe(true);
  });
});
