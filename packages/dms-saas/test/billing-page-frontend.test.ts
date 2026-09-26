import { describe, expect, it } from "vitest";
import { buildBillingCountryItems } from "../frontend-vue/app/composables/useBillingCountries";
import {
  type BillingIdentityDraft,
  emptyBillingIdentityDraft,
  findMissingBillingFields,
} from "../frontend-vue/app/composables/useBillingIdentity";

const COMPLETE_INDIVIDUAL: BillingIdentityDraft = {
  customerType: "individual",
  companyName: "",
  vatNumber: "",
  billingEmail: "billing@example.com",
  country: "BE",
  line1: "Rue Antoine Dansaert 12",
  postalCode: "1000",
  city: "Brussels",
};

describe("billing identity form validation", () => {
  it("flags every required field of an empty form", () => {
    expect(findMissingBillingFields(emptyBillingIdentityDraft())).toEqual([
      "customerType",
      "country",
      "line1",
      "postalCode",
      "city",
      "billingEmail",
    ]);
  });

  it("accepts a complete individual identity", () => {
    expect(findMissingBillingFields(COMPLETE_INDIVIDUAL)).toEqual([]);
  });

  it("requires the company name, not the VAT number, of a business", () => {
    expect(
      findMissingBillingFields({
        ...COMPLETE_INDIVIDUAL,
        customerType: "business",
        companyName: "  ",
      }),
    ).toEqual(["companyName"]);
  });

  it("rejects a malformed e-mail", () => {
    expect(
      findMissingBillingFields({
        ...COMPLETE_INDIVIDUAL,
        billingEmail: "billing@",
      }),
    ).toEqual(["billingEmail"]);
  });
});

describe("billing countries", () => {
  it("labels countries with their full name in the given locale", () => {
    const items = buildBillingCountryItems("fr-FR");
    expect(items.find((item) => item.value === "BE")?.label).toBe("Belgique");
    expect(items.find((item) => item.value === "DE")?.label).toBe("Allemagne");
  });

  it("sorts countries by their localized name", () => {
    const labels = buildBillingCountryItems("en-GB").map((item) => item.label);
    expect(labels).toEqual(
      [...labels].sort((left, right) => left.localeCompare(right, "en-GB")),
    );
  });
});
