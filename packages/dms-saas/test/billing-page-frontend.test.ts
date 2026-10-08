import { describe, expect, it } from "vitest";
import { buildBillingCountryItems } from "../frontend-vue/app/composables/useBillingCountries";
import {
  type BillingIdentityDraft,
  emptyBillingIdentityDraft,
  findMissingBillingFields,
} from "../frontend-vue/app/composables/useBillingIdentity";
import {
  formatCardExpiry,
  formatCardLabel,
} from "../frontend-vue/app/composables/useBillingStatus";
import {
  countDaysBetween,
  countDaysUntil,
} from "../frontend-vue/app/composables/useDaysLeft";
import { isInvoiceSettled } from "../frontend-vue/app/composables/usePayInvoice";
import {
  diffPlanFeatures,
  featureRank,
  readUpgradeParam,
  splitOfferedPlans,
} from "../frontend-vue/app/composables/usePlanChangeReview";
import type {
  OfferedPlanView,
  TenantPlanFeature,
} from "../frontend-vue/app/composables/useTenantPlan";

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

function offeredPlan(overrides: Partial<OfferedPlanView>): OfferedPlanView {
  return {
    _id: "plan",
    name: "Plan",
    price: 29,
    currency: "EUR",
    interval: "month",
    order: 0,
    checkoutAvailable: true,
    featureValues: {},
    description: "",
    billingMode: "flat",
    maxMembers: -1,
    trialDays: 0,
    isTrialOffered: false,
    ...overrides,
  };
}

function feature(featureId: string): TenantPlanFeature {
  return {
    featureId,
    displayName: featureId,
    tooltip: null,
    unit: null,
    valueType: "number",
    isDetailRow: false,
    order: 0,
  };
}

describe("upgrade arrival link", () => {
  it("reads the plan id of ?upgrade=", () => {
    expect(readUpgradeParam({ upgrade: "pro" })).toBe("pro");
    expect(readUpgradeParam({ upgrade: "  pro " })).toBe("pro");
    expect(readUpgradeParam({ upgrade: ["", "team"] })).toBe("team");
  });

  it("ignores a missing or empty parameter", () => {
    expect(readUpgradeParam({})).toBeNull();
    expect(readUpgradeParam({ upgrade: "" })).toBeNull();
    expect(readUpgradeParam({ upgrade: null })).toBeNull();
    expect(readUpgradeParam(undefined)).toBeNull();
  });
});

describe("plan comparison", () => {
  const seats = { members: 6, pendingInvites: 2, occupied: 8 };

  it("offers the plans the seats in use fit, and names the others", () => {
    const solo = offeredPlan({ _id: "solo", maxMembers: 1 });
    const team = offeredPlan({ _id: "team", maxMembers: 25 });
    const unlimited = offeredPlan({ _id: "enterprise", maxMembers: -1 });

    const split = splitOfferedPlans([solo, team, unlimited], seats, null);

    expect(split.offered.map((plan) => plan._id)).toEqual([
      "team",
      "enterprise",
    ]);
    expect(split.tooSmall.map((plan) => plan._id)).toEqual(["solo"]);
  });

  it("always keeps the current plan, even over its cap", () => {
    const pro = offeredPlan({ _id: "pro", maxMembers: 5 });
    expect(splitOfferedPlans([pro], seats, "pro").offered).toEqual([pro]);
  });

  it("ranks off, limits and unlimited", () => {
    expect(featureRank(false)).toBe(0);
    expect(featureRank(0)).toBe(0);
    expect(featureRank(undefined)).toBe(0);
    expect(featureRank(true)).toBe(1);
    expect(featureRank(50)).toBe(50);
    expect(featureRank(-1)).toBe(Number.POSITIVE_INFINITY);
  });

  it("lists the features gained and lost", () => {
    const features = [feature("storage"), feature("sso"), feature("audit")];
    const from = offeredPlan({
      featureValues: { storage: 1000, sso: true, audit: 30 },
    });
    const to = offeredPlan({
      featureValues: { storage: -1, sso: false, audit: 30 },
    });

    const diff = diffPlanFeatures(features, from, to);

    expect(diff.gained.map((change) => change.feature.featureId)).toEqual([
      "storage",
    ]);
    expect(diff.lost.map((change) => change.feature.featureId)).toEqual([
      "sso",
    ]);
  });
});

describe("billing formatting", () => {
  const card = { brand: "visa", last4: "4242", expMonth: 4, expYear: 2027 };

  it("names a card and its expiry", () => {
    expect(formatCardLabel(card)).toBe("Visa •••• 4242");
    expect(formatCardExpiry(card)).toBe("04/27");
  });

  it("counts the days left, a started day as one", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(countDaysUntil("2026-10-07T00:00:00Z", now)).toBe(8);
    expect(countDaysUntil("2026-09-20T00:00:00Z", now)).toBe(0);
    expect(countDaysBetween("2026-09-07T00:00:00Z", now)).toBe(22);
  });

  it("tells a settled payment from one Stripe is still processing", () => {
    expect(isInvoiceSettled({ status: "paid" })).toBe(true);
    expect(isInvoiceSettled({ status: "open" })).toBe(false);
  });
});
