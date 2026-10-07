import { describe, expect, it } from "vitest";
import {
  featureHighlights,
  findParentPlan,
  isIncludedValue,
  paidIntervals,
  plansForInterval,
  type PublicPlan,
  seatExample,
  sharedCurrency,
  splitComparisonRows,
} from "../frontend-vue/app/build/public/pricing";
import {
  billingUpgradePath,
  isInAppPath,
  isPublicScreenServed,
  loginPathThen,
  registerPathFor,
} from "../frontend-vue/app/build/public/routes";
import {
  missingRegistrationFields,
  type RegistrationFieldState,
  registrationFieldOf,
  registrationLandingPath,
} from "../frontend-vue/app/composables/useSaasRegistration";
import type { TenantPlanFeature } from "../frontend-vue/app/composables/useTenantPlan";

function plan(overrides: Partial<PublicPlan>): PublicPlan {
  return {
    _id: "plan",
    slug: "plan",
    name: "Plan",
    description: "",
    price: 0,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    trialDays: 0,
    maxMembers: 3,
    borderColor: null,
    borderLabel: null,
    order: 0,
    inheritsFromPlanId: null,
    featureValues: {},
    ...overrides,
  };
}

function feature(
  featureId: string,
  overrides: Partial<TenantPlanFeature> = {},
): TenantPlanFeature {
  return {
    featureId,
    displayName: featureId,
    tooltip: null,
    unit: null,
    valueType: "number",
    isDetailRow: false,
    order: 0,
    ...overrides,
  };
}

const FREE = plan({
  _id: "free",
  slug: "free",
  featureValues: { apps: 2, sso: false, storage: 5 },
});
const PRO_MONTHLY = plan({
  _id: "pro",
  slug: "pro",
  price: 29,
  order: 1,
  inheritsFromPlanId: "free",
  featureValues: { apps: 10, sso: false, storage: 5 },
});
const BUSINESS_YEARLY = plan({
  _id: "business",
  slug: "",
  price: 490,
  interval: "year",
  billingMode: "seat",
  maxMembers: -1,
  order: 2,
});

describe("pricing interval toggle", () => {
  it("only offers the intervals paid plans are sold in", () => {
    expect(paidIntervals([FREE, PRO_MONTHLY])).toEqual(["month"]);
    expect(paidIntervals([BUSINESS_YEARLY, FREE, PRO_MONTHLY])).toEqual([
      "month",
      "year",
    ]);
    expect(paidIntervals([FREE])).toEqual([]);
  });

  it("keeps the free plans whatever the interval", () => {
    const plans = [BUSINESS_YEARLY, PRO_MONTHLY, FREE];

    expect(plansForInterval(plans, "year").map((entry) => entry._id)).toEqual([
      "free",
      "business",
    ]);
    expect(plansForInterval(plans, "month").map((entry) => entry._id)).toEqual([
      "free",
      "pro",
    ]);
  });
});

describe("plan cards", () => {
  it("works the per-member price out for a team, under the cap", () => {
    expect(seatExample(BUSINESS_YEARLY)).toEqual({ seats: 10, total: 4900 });
    expect(seatExample({ ...BUSINESS_YEARLY, maxMembers: 5 })).toEqual({
      seats: 5,
      total: 2450,
    });
    expect(seatExample(PRO_MONTHLY)).toBeNull();
  });

  it("lists what a plan adds over the plan it extends", () => {
    const features = [
      feature("apps"),
      feature("sso", { valueType: "boolean" }),
      feature("storage"),
      feature("audit", { isDetailRow: true }),
    ];
    const parent = findParentPlan(PRO_MONTHLY, [FREE, PRO_MONTHLY]);

    expect(parent).toBe(FREE);
    expect(
      featureHighlights(PRO_MONTHLY, parent, features).map(
        (entry) => entry.feature.featureId,
      ),
    ).toEqual(["apps"]);
    expect(
      featureHighlights(FREE, null, features).map(
        (entry) => entry.feature.featureId,
      ),
    ).toEqual(["apps", "storage"]);
  });

  it("reads 0, false and empty as not included, −1 as unlimited", () => {
    expect(isIncludedValue(0)).toBe(false);
    expect(isIncludedValue(false)).toBe(false);
    expect(isIncludedValue("")).toBe(false);
    expect(isIncludedValue(-1)).toBe(true);
    expect(isIncludedValue(true)).toBe(true);
  });

  it("puts main comparison rows before the detail rows", () => {
    const rows = splitComparisonRows([
      feature("b", { order: 2 }),
      feature("detail", { order: 0, isDetailRow: true }),
      feature("a", { order: 1 }),
    ]);

    expect(rows.main.map((entry) => entry.featureId)).toEqual(["a", "b"]);
    expect(rows.detail.map((entry) => entry.featureId)).toEqual(["detail"]);
  });

  it("names one currency only when every plan shares it", () => {
    expect(sharedCurrency([FREE, PRO_MONTHLY])).toBe("EUR");
    expect(sharedCurrency([FREE, { ...PRO_MONTHLY, currency: "usd" }])).toBe(
      null,
    );
  });
});

describe("public routes", () => {
  it("serves every screen of a backend that publishes no list", () => {
    expect(isPublicScreenServed(undefined, "pricing")).toBe(true);
    expect(
      isPublicScreenServed({ publicScreens: ["register"] }, "pricing"),
    ).toBe(false);
  });

  it("builds the sign-up and upgrade links", () => {
    expect(registerPathFor("pro plan")).toBe("/register?plan=pro%20plan");
    expect(billingUpgradePath("plan-pro")).toBe(
      "/settings/workspace/billing?upgrade=plan-pro",
    );
    expect(loginPathThen("/settings/workspace/billing?upgrade=plan-pro")).toBe(
      "/auth/login?redirect=%2Fsettings%2Fworkspace%2Fbilling%3Fupgrade%3Dplan-pro",
    );
    expect(loginPathThen(null)).toBe("/auth/login");
  });

  it("keeps redirects on this site", () => {
    expect(isInAppPath("/pricing")).toBe(true);
    expect(isInAppPath("//evil.example")).toBe(false);
    expect(isInAppPath("/\\evil.example")).toBe(false);
    expect(isInAppPath("https://evil.example")).toBe(false);
  });
});

describe("registration fields", () => {
  const VALID: RegistrationFieldState = {
    name: "Margaux Petit",
    email: "margaux@northwind.test",
    isPasswordValid: true,
    isPaymentRequired: true,
    isPaymentReady: true,
    hasAcceptedLegal: true,
  };

  it("clears a complete form", () => {
    expect(missingRegistrationFields(VALID)).toEqual({});
  });

  it("marks every field still to fix at once", () => {
    expect(
      missingRegistrationFields({
        ...VALID,
        name: " ",
        email: "margaux",
        hasAcceptedLegal: false,
      }),
    ).toEqual({
      name: "saas.public.register.error.name_required",
      email: "saas.public.register.error.email_invalid",
      legal: "saas.public.register.error.legal_required",
    });
  });

  it("attaches the server's field refusals to their field", () => {
    expect(registrationFieldOf("saas.errors.user.email_in_use")).toBe("email");
    expect(
      registrationFieldOf("saas.errors.registration.payment_method_required"),
    ).toBe("card");
    expect(registrationFieldOf("saas.errors.registration_closed")).toBeNull();
    expect(registrationFieldOf(undefined)).toBeNull();
  });

  it("sends a paid choice to the upgrade review after sign-in", () => {
    const summary = {
      plan: FREE,
      requestedPlan: PRO_MONTHLY,
      features: [],
      rules: {
        moneyBackGuarantee: null,
        dataRetentionDays: 30,
        maxFreeWorkspacesPerCard: 1,
      },
    };

    expect(registrationLandingPath(summary)).toBe(
      "/auth/login?redirect=%2Fsettings%2Fworkspace%2Fbilling%3Fupgrade%3Dpro",
    );
    expect(registrationLandingPath({ ...summary, requestedPlan: null })).toBe(
      "/auth/login",
    );
    expect(registrationLandingPath(null)).toBe("/auth/login");
  });
});
