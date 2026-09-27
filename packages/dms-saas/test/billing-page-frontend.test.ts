import { describe, expect, it } from "vitest";
import { buildBillingCountryItems } from "../frontend-vue/app/composables/useBillingCountries";
import {
  type BillingIdentityDraft,
  emptyBillingIdentityDraft,
  findMissingBillingFields,
} from "../frontend-vue/app/composables/useBillingIdentity";
import { resolvePastDueBannerAction } from "../frontend-vue/app/composables/usePastDueBannerAction";

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

describe("past-due banner action", () => {
  const UNPAID_INVOICE = {
    number: "INV-0001",
    amount: 1200,
    currency: "eur",
    hostedInvoiceUrl: "https://invoice.stripe.test/i/1",
    failedAt: null,
    nextRetryAt: null,
    suspendAt: null,
  };

  it("offers the invoice payment page when Stripe provides one", () => {
    expect(
      resolvePastDueBannerAction({
        isTenantOwner: true,
        unpaidInvoice: UNPAID_INVOICE,
      }),
    ).toBe("settle");
  });

  it("sends the owner to the billing page without invoice details", () => {
    expect(
      resolvePastDueBannerAction({ isTenantOwner: true, unpaidInvoice: null }),
    ).toBe("open_billing");
    expect(
      resolvePastDueBannerAction({
        isTenantOwner: true,
        unpaidInvoice: { ...UNPAID_INVOICE, hostedInvoiceUrl: null },
      }),
    ).toBe("open_billing");
  });

  it("offers a member nothing to act on", () => {
    expect(
      resolvePastDueBannerAction({ isTenantOwner: false, unpaidInvoice: null }),
    ).toBe("none");
    expect(resolvePastDueBannerAction(null)).toBe("none");
  });
});
