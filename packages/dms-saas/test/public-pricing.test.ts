import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSettings, Feature, Plan } from "../src/db";
import {
  findPlanByReference,
  toPublicBillingRules,
} from "../src/routes/public/public-plan-catalog";

const FEATURE_MEMBERS = {
  _id: "members",
  displayName: "Members",
  tooltip: null,
  unit: null,
  valueType: "number",
  isDetailRow: false,
  order: 1,
} as unknown as Feature;

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "plan",
    slug: "plan",
    name: "Plan",
    description: "",
    audience: "any",
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
    features: [],
    permissions: ["secret.permission"],
    paymentProviderRefs: { stripePriceId: "price_secret" },
    isActive: true,
    isPublic: true,
    isDeleted: false,
    ...overrides,
  } as Plan;
}

const FREE = plan({
  _id: "plan-free",
  slug: "free",
  name: "Free",
  features: [{ featureId: "members", value: 3 }],
});
const PRO = plan({
  _id: "plan-pro",
  slug: "pro",
  name: "Pro",
  price: 29,
  order: 1,
  trialDays: 14,
  inheritsFromPlanId: "plan-free",
  features: [{ featureId: "members", value: 10 }],
});

const state = vi.hoisted(() => ({
  publicPlans: [] as Plan[],
  defaultPlan: null as Plan | null,
  settings: undefined as BillingSettings | undefined,
}));

const features = [
  { ...FEATURE_MEMBERS, localize: () => FEATURE_MEMBERS },
] as unknown as Feature[];

vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: (model: { name: string }) =>
      ({
        BillingSettingsModel: { get: async () => state.settings },
        PlanModel: { resolveInheritance: async (entry: Plan) => entry },
        FeatureModel: { getAll: async () => features },
      })[model.name],
  }),
);

vi.mock("../src/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/workspaces")>()),
  resolveDefaultPlan: async () => state.defaultPlan,
  resolveRegistrationPlan: async () => state.defaultPlan,
}));

const { SaasPricingController } = await import("../src/routes/public/pricing");
const { SaasRegisterApiController } =
  await import("../src/routes/public/register");

function pricingController() {
  const controller = new SaasPricingController();
  Object.assign(controller, {
    planModel: { findPubliclyVisible: async () => state.publicPlans },
  });
  return controller;
}

function registerController() {
  const controller = new SaasRegisterApiController();
  Object.assign(controller, {
    planModel: { findPubliclyVisible: async () => state.publicPlans },
  });
  return controller;
}

beforeEach(() => {
  state.publicPlans = [PRO, FREE];
  state.defaultPlan = FREE;
  state.settings = undefined;
});

describe("toPublicBillingRules", () => {
  it("applies the billing defaults when nothing was saved", () => {
    expect(toPublicBillingRules(undefined)).toEqual({
      moneyBackGuarantee: null,
      dataRetentionDays: 30,
      maxFreeWorkspacesPerCard: 1,
    });
  });

  it("states the guarantee only when it is enabled", () => {
    const settings = {
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: 14,
      moneyBackGuaranteeMode: "prorated",
      dataRetentionDaysAfterCancellation: 60,
      maxFreeWorkspacesPerCard: 2,
    } as BillingSettings;

    expect(toPublicBillingRules(settings)).toEqual({
      moneyBackGuarantee: { windowDays: 14, mode: "prorated" },
      dataRetentionDays: 60,
      maxFreeWorkspacesPerCard: 2,
    });
    expect(
      toPublicBillingRules({
        ...settings,
        moneyBackGuaranteeEnabled: false,
      } as BillingSettings).moneyBackGuarantee,
    ).toBeNull();
  });
});

describe("findPlanByReference", () => {
  it("finds a plan by slug first, then by id", () => {
    expect(findPlanByReference([FREE, PRO], "pro")).toBe(PRO);
    expect(findPlanByReference([FREE, PRO], "plan-free")).toBe(FREE);
  });

  it("finds nothing for an unknown or missing reference", () => {
    expect(findPlanByReference([FREE, PRO], "enterprise")).toBeUndefined();
    expect(findPlanByReference([FREE, PRO], undefined)).toBeUndefined();
    expect(findPlanByReference([FREE, PRO], ["pro"])).toBeUndefined();
  });
});

describe("GET /api/saas/pricing", () => {
  it("lists the public plans in catalogue order with their values", async () => {
    const pricing = await pricingController().getPricing("fr");

    expect(pricing.plans.map((entry) => entry.slug)).toEqual(["free", "pro"]);
    expect(pricing.plans[1]).toMatchObject({
      price: 29,
      trialDays: 14,
      inheritsFromPlanId: "plan-free",
      featureValues: { members: 10 },
    });
    expect(pricing.features.map((feature) => feature.featureId)).toEqual([
      "members",
    ]);
    expect(pricing.defaultPlanId).toBe("plan-free");
  });

  it("never sends what is not for visitors", async () => {
    const pricing = await pricingController().getPricing(undefined);

    expect(pricing.plans[0]).not.toHaveProperty("permissions");
    expect(pricing.plans[0]).not.toHaveProperty("paymentProviderRefs");
    expect(pricing.plans[0]).not.toHaveProperty("isActive");
  });

  it("names no default plan when it is not on sale", async () => {
    state.publicPlans = [PRO];

    expect((await pricingController().getPricing("en")).defaultPlanId).toBe(
      null,
    );
  });

  it("carries the public billing rules", async () => {
    state.settings = {
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: 14,
      moneyBackGuaranteeMode: "full",
    } as BillingSettings;

    expect(
      (await pricingController().getPricing("en")).rules.moneyBackGuarantee,
    ).toEqual({ windowDays: 14, mode: "full" });
  });
});

describe("GET /api/saas/register/plan", () => {
  it("describes the default plan the workspace opens on", async () => {
    const summary = await registerController().describeRegistrationPlan(
      undefined,
      "en",
    );

    expect(summary.plan._id).toBe("plan-free");
    expect(summary.requestedPlan).toBeNull();
    expect(summary.rules.maxFreeWorkspacesPerCard).toBe(1);
  });

  it("adds the public plan chosen on Pricing", async () => {
    const summary = await registerController().describeRegistrationPlan(
      "pro",
      "en",
    );

    expect(summary.plan._id).toBe("plan-free");
    expect(summary.requestedPlan?._id).toBe("plan-pro");
  });

  it("ignores a choice that is the default plan or not on sale", async () => {
    const controller = registerController();

    await expect(
      controller.describeRegistrationPlan("free", "en"),
    ).resolves.toMatchObject({ requestedPlan: null });
    state.publicPlans = [FREE];
    await expect(
      controller.describeRegistrationPlan("pro", "en"),
    ).resolves.toMatchObject({ requestedPlan: null });
  });
});
