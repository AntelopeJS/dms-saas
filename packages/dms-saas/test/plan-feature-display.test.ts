import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatPlanFeatureValue,
  type FormattableFeature,
  type PlanFeatureFormatContext,
} from "../frontend-vue/app/composables/usePlanFeatureFormat";
import {
  type LabelledFeature,
  resolvePlanFeatureLabel,
  resolvePlanFeatureTooltip,
} from "../frontend-vue/app/composables/usePlanFeatureLabel";

type LocaleTree = { [key: string]: string | LocaleTree };

const PLURAL_SEPARATOR = " | ";
const UNLIMITED = "unlimited";

function readLocale(file: string): LocaleTree {
  const url = new URL(`../frontend-vue/i18n/locales/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as LocaleTree;
}

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
    ["vCPU-minute", 6_000, "100 vCPU-hours"],
    ["vCPU-minute", 60, "1 vCPU-hour"],
    ["GiB-minute", 90, "1.5 GiB-hours"],
    ["GB-hour", 14_600, "20 GB-months"],
    ["build minute", 2_000, "2,000 build minutes"],
  ])("converts a %s quantity of %d to %s", (unit, value, expected) => {
    expect(formatPlanFeatureValue(numeric(unit), value, context("en-GB"))).toBe(
      expected,
    );
  });

  it.each([
    ["per vCPU-minute", 0.0005, "€0.03 / vCPU-hour"],
    ["per GiB-minute", 0.00005, "€0.003 / GiB-hour"],
    ["per GB-hour", 0.0002, "€0.146 / GB-month"],
    ["per byte", 0.00000000009, "€0.09 / GB"],
    ["per build minute", 0.008, "€0.008 / build minute"],
    ["per seat", 12.5, "€12.50 per seat"],
    ["per vCPU-minute", 0, "€0.00 / vCPU-hour"],
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
        numeric("per vCPU-minute"),
        0.0005,
        context("en-GB", null),
      ),
    ).toBe("0.03 / vCPU-hour");
  });

  it("localises units and number grouping in French", () => {
    const fr = context("fr-FR");
    expect(
      plain(formatPlanFeatureValue(numeric("byte"), 100_000_000_000, fr)),
    ).toBe("100 Go");
    expect(
      plain(formatPlanFeatureValue(numeric("vCPU-minute"), 600_000, fr)),
    ).toBe("10 000 heures vCPU");
    expect(
      plain(formatPlanFeatureValue(numeric("per GB-hour"), 0.0002, fr)),
    ).toBe("0,146 € / Go-mois");
  });
});

describe("plan feature labels", () => {
  const feature: LabelledFeature = {
    featureId: "cloud.included.egress_bytes",
    displayName: "Cloud included · egress_bytes",
    tooltip: "Stored tooltip",
  };

  function lookupFrom(messages: Record<string, string>) {
    return (key: string) => messages[key] ?? null;
  }

  it("prefers the first consumer prefix that translates the feature", () => {
    const lookup = lookupFrom({
      "cloud.plan_features.cloud.included.egress_bytes.label":
        "Egress included",
      "saas.plan_features.cloud.included.egress_bytes.label": "Built-in label",
    });
    expect(
      resolvePlanFeatureLabel(
        feature,
        ["missing.prefix", "cloud.plan_features"],
        lookup,
      ),
    ).toBe("Egress included");
  });

  it("falls back to the built-in saas prefix", () => {
    const lookup = lookupFrom({
      "saas.plan_features.cloud.included.egress_bytes.tooltip": "Built-in",
    });
    expect(resolvePlanFeatureTooltip(feature, [], lookup)).toBe("Built-in");
  });

  it("falls back to the stored display name and tooltip", () => {
    const lookup = lookupFrom({});
    expect(
      resolvePlanFeatureLabel(feature, ["cloud.plan_features"], lookup),
    ).toBe("Cloud included · egress_bytes");
    expect(
      resolvePlanFeatureTooltip(feature, ["cloud.plan_features"], lookup),
    ).toBe("Stored tooltip");
  });
});
