import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCALES = ["en-GB", "fr-FR"];

/** Messages that name a seat count, by locale file and key path. */
const SEAT_COUNT_MESSAGES: Record<string, string[]> = {
  "saas-tenant-billing": [
    "saas.tenant_billing.plan.seats_unlimited",
    "saas.tenant_billing.plan_change.subtitle",
    "saas.tenant_billing.plan_change.for_seats",
    "saas.tenant_billing.plan_change.seat_total",
    "saas.tenant_billing.plan_change.too_small",
  ],
  "saas-operator-workspaces": [
    "saas.workspace_detail.complimentary.fits",
    "saas.workspace_detail.complimentary.fits_unlimited",
    "saas.workspace_detail.complimentary.exceeds",
  ],
  "saas-tenant-workspace": ["saas.workspace.general.glance.seats_unlimited"],
};

type Messages = { [key: string]: Messages | string };

function lookUp(messages: Messages, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<Messages | string | undefined>(
      (node, key) => (typeof node === "object" ? node[key] : undefined),
      messages,
    );
  return typeof value === "string" ? value : undefined;
}

function load(file: string, locale: string): Messages {
  const url = new URL(
    `../frontend-vue/i18n/locales/${file}-${locale}.json`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, "utf8")) as Messages;
}

describe("seat counts", () => {
  // "1 seats in use" read on every new workspace's plan comparison.
  it.each(LOCALES)("have a singular and a plural form in %s", (locale) => {
    for (const [file, keys] of Object.entries(SEAT_COUNT_MESSAGES)) {
      const messages = load(file, locale);
      for (const key of keys) {
        expect(lookUp(messages, key), key).toMatch(/^[^|]+ \| [^|]+$/);
      }
    }
  });
});
