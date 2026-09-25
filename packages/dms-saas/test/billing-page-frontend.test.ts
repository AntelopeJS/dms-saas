import { afterEach, describe, expect, it } from "vitest";
import { buildBillingCountryItems } from "../frontend-vue/app/composables/useBillingCountries";
import {
  type BillingIdentityDraft,
  emptyBillingIdentityDraft,
  findMissingBillingFields,
} from "../frontend-vue/app/composables/useBillingIdentity";
import {
  claimPastDueBannerHost,
  isPastDueBannerVisible,
  releasePastDueBannerHost,
} from "../frontend-vue/app/composables/usePastDueBanner";
import type { WorkspaceAccess } from "../frontend-vue/app/composables/useWorkspaceAccessCache";

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

function access(status?: string): WorkspaceAccess {
  return {
    blocked: status === "suspended",
    status,
    isTenantOwner: true,
    unpaidInvoice: null,
  };
}

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

describe("past-due banner visibility", () => {
  it.each([
    ["active", false],
    ["trialing", false],
    ["pending_payment", false],
    ["suspended", false],
    ["cancelled", false],
    [undefined, false],
    ["past_due", true],
  ])("shows for status %s: %s", (status, expected) => {
    expect(isPastDueBannerVisible(access(status))).toBe(expected);
  });

  it("stays hidden until the workspace access is known", () => {
    expect(isPastDueBannerVisible(null)).toBe(false);
  });
});

describe("past-due banner host ownership", () => {
  const first = Symbol("first");
  const second = Symbol("second");

  afterEach(() => {
    releasePastDueBannerHost(first);
    releasePastDueBannerHost(second);
  });

  it("lets a single host render the banner", () => {
    expect(claimPastDueBannerHost(first)).toBe(true);
    expect(claimPastDueBannerHost(second)).toBe(false);
  });

  it("hands the host over once the owner releases it", () => {
    claimPastDueBannerHost(first);
    releasePastDueBannerHost(first);
    expect(claimPastDueBannerHost(second)).toBe(true);
  });
});
