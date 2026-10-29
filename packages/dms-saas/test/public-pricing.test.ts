import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeEach, describe, expect, it } from "vitest";
import { planRow } from "./helpers/plan-row";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  BillingSettingsModel,
  type Feature,
  FeatureModel,
  type Plan,
  PlanModel,
} from "../src/db";
import { SaasPricingController } from "../src/routes/public/pricing";
import {
  findPlanByReference,
  toPublicBillingRules,
} from "../src/routes/public/public-plan-catalog";
import { SaasRegisterApiController } from "../src/routes/public/register";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("public-pricing");

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
  return planRow({
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
  } as Partial<Plan>);
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

/** Publishes the catalogue: `plans` on sale, `offSale` active but not public. */
async function publishCatalogue(
  plans: Plan[],
  offSale: Plan[] = [],
): Promise<void> {
  await GetModel(PlanModel).table.delete().run();
  await GetModel(PlanModel).insert([
    ...plans,
    ...offSale.map((entry) => ({ ...entry, isPublic: false })),
  ]);
}

async function publishBillingSettings(
  settings: Partial<BillingSettings>,
): Promise<void> {
  await GetModel(BillingSettingsModel).insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    ...settings,
  });
}

function pricingController() {
  const controller = new SaasPricingController();
  controller.planModel = GetModel(PlanModel);
  return controller;
}

function registerController() {
  const controller = new SaasRegisterApiController();
  controller.planModel = GetModel(PlanModel);
  return controller;
}

beforeEach(async () => {
  await publishCatalogue([PRO, FREE]);
  await GetModel(BillingSettingsModel).table.delete().run();
  await GetModel(FeatureModel).table.delete().run();
  await GetModel(FeatureModel).insert(FEATURE_MEMBERS);
});

describe("toPublicBillingRules", () => {
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
    await publishCatalogue([PRO], [FREE]);

    expect((await pricingController().getPricing("en")).defaultPlanId).toBe(
      null,
    );
  });

  it("carries the public billing rules", async () => {
    await publishBillingSettings({
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: 14,
      moneyBackGuaranteeMode: "full",
    });

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
    expect(summary.rules.maxFreeWorkspacesPerCard).toBe(0);
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
    await publishCatalogue([FREE], [PRO]);
    await expect(
      controller.describeRegistrationPlan("pro", "en"),
    ).resolves.toMatchObject({ requestedPlan: null });
  });
});
