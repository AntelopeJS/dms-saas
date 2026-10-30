import { afterEach, describe, expect, it, vi } from "vitest";
import { useSaasStatus } from "../frontend-vue/app/composables/useSaasStatus";
import {
  fromMinorUnits,
  toMinorUnits,
} from "../frontend-vue/app/composables/useMoneyFormat";
import { BILLING_STATES } from "../src/db";
import {
  type StatusFamily,
  STATUS_TONES,
  statusItems,
  statusPillDisplay,
  WORKSPACE_STATUS_ORDER,
} from "../src/utils/status-vocabulary";
import { flattenLocale, readLocale } from "./helpers/locales";

const LOCALES = ["en-GB", "fr-FR"];

function isStatusFamily(name: string): name is StatusFamily {
  return Object.hasOwn(STATUS_TONES, name);
}

const FAMILIES = Object.keys(STATUS_TONES).filter(isStatusFamily);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("status vocabulary", () => {
  it("gives the frontend the backend's tone of every status", () => {
    vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }));
    const { statusView } = useSaasStatus();
    const served = FAMILIES.flatMap((family) =>
      Object.entries(statusPillDisplay(family).options?.tones ?? {}).map(
        ([status, tone]) => ({ family, status, tone }),
      ),
    );

    expect(served.length).toBeGreaterThan(0);
    for (const { family, status, tone } of served) {
      expect(statusView(family, status)).toMatchObject({ tone });
    }
  });

  it.each(LOCALES)("%s names every status of every family", (code) => {
    const keys = flattenLocale(readLocale(code));
    const missing = FAMILIES.flatMap((family) =>
      statusItems(family)
        .map((item) => item.label.slice(1))
        .filter((key) => !keys.has(key)),
    );

    expect(missing).toEqual([]);
  });

  it("lists every workspace status once", () => {
    expect([...WORKSPACE_STATUS_ORDER].sort()).toEqual(
      [...BILLING_STATES].sort(),
    );
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
