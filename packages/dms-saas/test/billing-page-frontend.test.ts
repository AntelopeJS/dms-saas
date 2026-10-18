import { describe, expect, it } from "vitest";
import {
  fromAddressInputValue,
  joinStreetLine,
  splitStreetLine,
  toAddressInputValue,
} from "../frontend-vue/app/composables/useBillingAddress";
import { formatBillingCountry } from "../frontend-vue/app/composables/useBillingCountries";
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
  readPlanChangeIncompatibilities,
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
  line2: "",
  postalCode: "1000",
  city: "Brussels",
  state: "",
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
  it("names a country in the given locale", () => {
    expect(formatBillingCountry("BE", "fr-FR")).toBe("Belgique");
    expect(formatBillingCountry("DE", "en-GB")).toBe("Germany");
  });
});

describe("billing address input mapping", () => {
  const STORED = {
    line1: "Rue de l'Ermitage 41/2",
    line2: "2e étage",
    postalCode: "4000",
    city: "Liège",
    state: "Wallonie",
    country: "BE",
  };

  it("splits the stored street line into the input's parts", () => {
    expect(toAddressInputValue(STORED)).toEqual({
      streetName: "Rue de l'Ermitage",
      houseNumber: "41",
      boxNumber: "2",
      addressLine2: "2e étage",
      postalCode: "4000",
      city: "Liège",
      countrySubdivision: "Wallonie",
      countryCode: "BE",
    });
  });

  it("reads a box named after the number, and a comma before it", () => {
    expect(splitStreetLine("Rue X, 12 bte 3")).toEqual({
      streetName: "Rue X",
      houseNumber: "12",
      boxNumber: "3",
    });
  });

  it("keeps a line with the number first as the street name", () => {
    expect(splitStreetLine("10 Downing Street")).toEqual({
      streetName: "10 Downing Street",
      houseNumber: "",
      boxNumber: "",
    });
  });

  it("joins the parts back into one street line", () => {
    expect(
      joinStreetLine({ streetName: "Rue X", houseNumber: "12", boxNumber: "" }),
    ).toBe("Rue X 12");
    expect(
      splitStreetLine(joinStreetLine(splitStreetLine(STORED.line1))),
    ).toEqual(splitStreetLine(STORED.line1));
  });

  it("maps a picked address to the stored billing fields", () => {
    const picked = {
      streetName: "Boulevard Frère-Orban",
      houseNumber: "18",
      boxNumber: "",
      addressLine2: "",
      postalCode: "4000",
      city: "Liège",
      countrySubdivision: "Liège",
      countryCode: "be",
    };
    expect(fromAddressInputValue(picked, STORED)).toEqual({
      line1: "Boulevard Frère-Orban 18",
      line2: "",
      postalCode: "4000",
      city: "Liège",
      state: "Liège",
      country: "BE",
    });
  });

  it("leaves a street line it cannot rebuild as typed when only the city changes", () => {
    const stored = { ...STORED, line1: "Rue X, 12 bte 3" };
    const value = { ...toAddressInputValue(stored), city: "Namur" };
    expect(fromAddressInputValue(value, stored)).toEqual({
      ...stored,
      city: "Namur",
    });
  });

  it("leaves the required parts of a cleared address to the form's checks", () => {
    const cleared = fromAddressInputValue(
      { streetName: "", postalCode: "", city: "", countryCode: "" },
      STORED,
    );
    expect(
      findMissingBillingFields({ ...COMPLETE_INDIVIDUAL, ...cleared }),
    ).toEqual(["country", "line1", "postalCode", "city"]);
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
    audience: "any",
    isOfferedToCustomerType: true,
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

  it("names apart the plans sold to the other customer type", () => {
    const pro = offeredPlan({ _id: "pro", maxMembers: 10 });
    const team = offeredPlan({
      _id: "team",
      maxMembers: 25,
      audience: "business",
      isOfferedToCustomerType: false,
    });

    const split = splitOfferedPlans([pro, team], seats, "pro");

    expect(split.offered).toEqual([pro]);
    expect(split.forOtherCustomerType).toEqual([team]);
    expect(split.tooSmall).toEqual([]);
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

  it("leaves out a feature unlimited on both plans", () => {
    const features = [feature("projects"), feature("storage")];
    const business = offeredPlan({
      featureValues: { projects: -1, storage: 1000 },
    });
    const team = offeredPlan({ featureValues: { projects: -1, storage: 250 } });

    const diff = diffPlanFeatures(features, business, team);

    expect(diff.gained).toEqual([]);
    expect(diff.lost.map((change) => change.feature.featureId)).toEqual([
      "storage",
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

describe("plan change refused by the workspace's inventory", () => {
  const INCOMPATIBILITY = {
    code: "projects_per_workspace",
    resource: "tenant-1",
    message:
      "Stored configuration exceeds the target plan: projects_per_workspace",
  };

  it("reads what the target plan cannot hold from the 409 body", () => {
    const refusal = {
      data: {
        code: "saas.errors.plan.incompatible",
        incompatibilities: [INCOMPATIBILITY],
      },
    };

    expect(readPlanChangeIncompatibilities(refusal)).toEqual([INCOMPATIBILITY]);
  });

  it("leaves every other failure to the generic error", () => {
    expect(
      readPlanChangeIncompatibilities({ data: "saas.errors.plan.invalid" }),
    ).toBeNull();
    expect(
      readPlanChangeIncompatibilities({
        data: { code: "saas.errors.plan.incompatible" },
      }),
    ).toBeNull();
    expect(readPlanChangeIncompatibilities(new Error("network"))).toBeNull();
  });
});
