import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FIELDS_PATH = new URL(
  "../frontend-vue/app/components/BillingIdentityFields.vue",
  import.meta.url,
);

describe("BillingIdentityFields", () => {
  const source = readFileSync(FIELDS_PATH, "utf8");

  // Vue's Fragment drawn through <component :is> drops its slot: the upgrade
  // dialog then lost the company, VAT, postal code, city and country fields.
  it("never wraps fields in a Fragment drawn as a component", () => {
    expect(source).not.toMatch(/\bFragment\b(?!`)/);
    expect(source).toContain("slots.default?.()");
  });

  it("names the billing e-mail input when its row carries no label", () => {
    expect(source).toMatch(
      /v-model="draft\.billingEmail"\s+:aria-label="\$t\(`\$\{KEY_PREFIX\}\.billing_email`\)"/,
    );
  });
});
