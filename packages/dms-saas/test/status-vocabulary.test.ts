import { describe, expect, it } from "vitest";
import { SAAS_STATUS_TONES } from "../frontend-vue/app/composables/useSaasStatus";
import {
  fromMinorUnits,
  toMinorUnits,
} from "../frontend-vue/app/composables/useMoneyFormat";
import { STATUS_TONES, statusItems } from "../src/utils/status-vocabulary";
import { flattenLocale, readLocale } from "./helpers/locales";

const LOCALES = ["en-GB", "fr-FR"];

describe("status vocabulary", () => {
  it("gives the frontend the backend's tone of every status", () => {
    expect(SAAS_STATUS_TONES).toEqual(STATUS_TONES);
  });

  it.each(LOCALES)("%s names every status of every family", (code) => {
    const keys = flattenLocale(readLocale(code));
    const families = Object.keys(STATUS_TONES) as (keyof typeof STATUS_TONES)[];
    const missing = families.flatMap((family) =>
      statusItems(family)
        .map((item) => item.label.slice(1))
        .filter((key) => !keys.has(key)),
    );

    expect(missing).toEqual([]);
  });
});

describe("money typed in major units", () => {
  it("converts euros to cents and back", () => {
    expect(toMinorUnits(49.5, "EUR")).toBe(4950);
    expect(toMinorUnits(0.1 + 0.2, "eur")).toBe(30);
    expect(fromMinorUnits(4950, "EUR")).toBe(49.5);
  });

  it("follows a currency without minor unit", () => {
    expect(toMinorUnits(1200, "JPY")).toBe(1200);
    expect(fromMinorUnits(1200, "JPY")).toBe(1200);
  });
});
