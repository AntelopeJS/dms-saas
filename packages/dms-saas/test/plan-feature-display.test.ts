import { createRequire } from "node:module";
import path from "node:path";
import { readLocale } from "./helpers/locales";
import { describe, expect, it, vi } from "vitest";
import {
  formatPlanFeatureValue,
  type FormattableFeature,
  type PlanFeatureFormatContext,
  registerPlanFeatureUnit,
} from "../frontend-vue/app/composables/usePlanFeatureFormat";

type LocaleTree = { [key: string]: string | LocaleTree };

const PLURAL_SEPARATOR = " | ";
const UNLIMITED = "unlimited";

function resolveMessage(tree: LocaleTree, key: string): string | null {
  let node: string | LocaleTree | undefined = tree;
  for (const segment of key.split(".")) {
    if (typeof node !== "object") return null;
    node = node[segment];
  }
  return typeof node === "string" ? node : null;
}

/** Mirrors vue-i18n's two-choice plural rule and named interpolation. */
function translator(
  tree: LocaleTree,
): PlanFeatureFormatContext["translateUnit"] {
  return (key, params, count) => {
    const message = resolveMessage(tree, key);
    if (message === null) throw new Error(`missing locale key ${key}`);
    const choices = message.split(PLURAL_SEPARATOR);
    const choice =
      choices.length > 1 && count !== 1 ? choices[1]! : choices[0]!;
    return choice.replace(
      /\{(\w+)\}/g,
      (_, name: string) => params[name] ?? "",
    );
  };
}

const require = createRequire(import.meta.url);
const dmsRoot = path.dirname(require.resolve("@antelopejs/dms/package.json"));
type Translate = (key: string) => string;

interface DmsTranslationHelpers {
  resolveI18nKey: (translate: Translate, key: string) => string;
  resolveOptionalI18nKey: (
    translate: Translate,
    key: string | undefined,
  ) => string | undefined;
}

// The real DMS helpers the plan pages get auto-imported, not a re-implementation.
const dmsTranslation = (await import(
  path.join(
    dmsRoot,
    "frontend-vue/layers/dms-core/app/composables/translation/useTranslation.ts",
  )
)) as DmsTranslationHelpers;

/** Messages a consumer module ships for its text feature values. */
const VALUE_MESSAGES: Record<string, string> = {
  "cloud.plan_features.values.upgrade": "Upgrade required",
};

const EN = readLocale("saas-en-GB.json");
const FR = readLocale("saas-fr-FR.json");

function context(
  locale: "en-GB" | "fr-FR",
  currency: string | null = "EUR",
): PlanFeatureFormatContext {
  return {
    locale,
    currency,
    unlimitedLabel: UNLIMITED,
    translateUnit: translator(locale === "en-GB" ? EN : FR),
    translateText: (text) =>
      dmsTranslation.resolveI18nKey((key) => VALUE_MESSAGES[key] ?? key, text),
  };
}

function numeric(unit: string | null): FormattableFeature {
  return { valueType: "number", unit };
}

/** Normalises the narrow no-break spaces Intl puts in French numbers. */
function plain(text: string): string {
  return text.replace(/[  ]/g, " ");
}

describe("plan feature value formatting", () => {
  it.each([
    [numeric(null), -1, UNLIMITED],
    [numeric("byte"), "-1", UNLIMITED],
    [{ valueType: "boolean", unit: null }, true, "✓"],
    [{ valueType: "boolean", unit: null }, false, "—"],
    [{ valueType: "boolean", unit: null }, "false", "—"],
    [numeric(null), undefined, "—"],
    [numeric(null), "", "—"],
    [numeric(null), "not a number", "—"],
    [numeric(null), 1234567, "1,234,567"],
    [numeric("resources"), 25000, "25,000 resources"],
    [numeric("requests per 15 minutes"), 1000, "1,000 requests per 15 minutes"],
    [{ valueType: "string", unit: null }, "Priority", "Priority"],
    [
      { valueType: "string", unit: null },
      "$cloud.plan_features.values.upgrade",
      "Upgrade required",
    ],
    [{ valueType: "string", unit: "support" }, "24/7", "24/7 support"],
    // Q36: one meaning everywhere, 0 is off, -1 unlimited, n ≥ 1 a limit.
    [numeric(null), 0, "—"],
    [numeric("projects"), 0, "—"],
    [numeric("projects"), 1, "1 projects"],
  ])("renders %o with value %o as %s", (feature, value, expected) => {
    expect(formatPlanFeatureValue(feature, value, context("en-GB"))).toBe(
      expected,
    );
  });

  it.each([
    [512, "512 bytes"],
    [1, "1 byte"],
    [1_500, "1.5 KB"],
    [250_000_000, "250 MB"],
    [100_000_000_000, "100 GB"],
    [2_500_000_000_000, "2.5 TB"],
  ])("scales %d bytes to %s", (value, expected) => {
    expect(
      formatPlanFeatureValue(numeric("byte"), value, context("en-GB")),
    ).toBe(expected);
  });

  it.each([
    ["minute", 1, "1 minute"],
    ["minutes", 2_000, "2,000 minutes"],
  ])("reads a %s quantity of %d as %s", (unit, value, expected) => {
    expect(formatPlanFeatureValue(numeric(unit), value, context("en-GB"))).toBe(
      expected,
    );
  });

  it.each([
    ["per byte", 0.00000000009, "€0.09 / GB"],
    ["per minute", 0.008, "€0.008 / minute"],
    ["per seat", 12.5, "€12.50 per seat"],
    ["per minute", 0, "€0.00 / minute"],
    ["per API call", 0.0005, "€0.0005 per API call"],
  ])("reads a %s price of %d as %s", (unit, value, expected) => {
    expect(formatPlanFeatureValue(numeric(unit), value, context("en-GB"))).toBe(
      expected,
    );
  });

  it("reads a currency amount in the plan's currency", () => {
    expect(
      formatPlanFeatureValue(numeric("currency units"), 20, context("en-GB")),
    ).toBe("€20.00");
  });

  it("falls back to a plain number when the plan has no currency", () => {
    expect(
      formatPlanFeatureValue(
        numeric("per byte"),
        0.00000000009,
        context("en-GB", null),
      ),
    ).toBe("0.09 / GB");
  });

  it("localises units and number grouping in French", () => {
    const fr = context("fr-FR");
    expect(
      plain(formatPlanFeatureValue(numeric("byte"), 100_000_000_000, fr)),
    ).toBe("100 Go");
    expect(plain(formatPlanFeatureValue(numeric("minutes"), 10_000, fr))).toBe(
      "10 000 minutes",
    );
    expect(
      plain(formatPlanFeatureValue(numeric("per byte"), 0.00000000009, fr)),
    ).toBe("0,09 € / Go");
  });
});

describe("registered plan feature units", () => {
  const CONSUMER_MESSAGES: LocaleTree = {
    cloud: {
      units: {
        vcpu_hour: {
          quantity: "{value} vCPU-hour | {value} vCPU-hours",
          price: "{price} / vCPU-hour",
        },
        vcpu_day: {
          quantity: "{value} vCPU-day | {value} vCPU-days",
          price: "{price} / vCPU-day",
        },
        pod: {
          quantity: "{value} pod | {value} pods",
          price: "{price} / pod",
        },
      },
    },
  };
  const MINUTES_PER_HOUR = 60;
  const MINUTES_PER_DAY = 1_440;

  function consumerContext(): PlanFeatureFormatContext {
    return {
      ...context("en-GB"),
      translateUnit: translator({ ...EN, ...CONSUMER_MESSAGES }),
    };
  }

  registerPlanFeatureUnit(["vCPU-minute", "vCPU-minutes"], {
    scales: [
      { label: "cloud.units.vcpu_day", size: MINUTES_PER_DAY },
      { label: "cloud.units.vcpu_hour", size: MINUTES_PER_HOUR },
    ],
    priceScale: { label: "cloud.units.vcpu_hour", size: MINUTES_PER_HOUR },
  });

  it.each([
    ["vCPU-minute", 60, "1 vCPU-hour"],
    ["VCPU-MINUTES", 1_200, "20 vCPU-hours"],
    ["vCPU-minutes", 4_320, "3 vCPU-days"],
    ["vCPU-minute", 30, "0.5 vCPU-hours"],
  ])("scales a %s quantity of %d to %s", (unit, value, expected) => {
    expect(
      formatPlanFeatureValue(numeric(unit), value, consumerContext()),
    ).toBe(expected);
  });

  it("reads a registered unit's price per its price scale", () => {
    expect(
      formatPlanFeatureValue(
        numeric("per vCPU-minute"),
        0.0005,
        consumerContext(),
      ),
    ).toBe("€0.03 / vCPU-hour");
  });

  it("lets a registered unit override a built-in one", async () => {
    // A fresh module instance keeps the override out of the other tests.
    vi.resetModules();
    const fresh =
      await import("../frontend-vue/app/composables/usePlanFeatureFormat");
    fresh.registerPlanFeatureUnit("minutes", {
      scales: [{ label: "cloud.units.pod", size: 1 }],
      priceScale: { label: "cloud.units.pod", size: 1 },
    });
    expect(
      fresh.formatPlanFeatureValue(numeric("minutes"), 3, consumerContext()),
    ).toBe("3 pods");
  });

  it("refuses a rule without a positive scale", () => {
    expect(() =>
      registerPlanFeatureUnit("empty", {
        scales: [],
        priceScale: { label: "cloud.units.pod", size: 1 },
      }),
    ).toThrow("Invalid plan feature unit rule");
    expect(() =>
      registerPlanFeatureUnit("zero", {
        scales: [{ label: "cloud.units.pod", size: 0 }],
        priceScale: { label: "cloud.units.pod", size: 1 },
      }),
    ).toThrow("Invalid plan feature unit rule");
  });
});
