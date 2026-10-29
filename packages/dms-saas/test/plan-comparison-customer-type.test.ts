import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FeatureModel,
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { isPlanOfferedTo } from "../src/plans/plan-audience";
import {
  addTenantMember,
  createUser,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("plan-comparison-customer-type");
useDmsAuth();

const PUBLIC_PLAN = {
  isActive: true,
  isPublic: true,
  isDeleted: false,
  price: 29,
  trialDays: 0,
  billingMode: "flat",
  features: [],
};

beforeAll(async () => {
  await GetModel(PlanModel).insert([
    { ...PUBLIC_PLAN, _id: "pro", name: "Pro", audience: "any", order: 1 },
    {
      ...PUBLIC_PLAN,
      _id: "team",
      name: "Team",
      audience: "business",
      order: 2,
    },
  ]);
});

async function offeredPlans(customerType: "individual" | "business" | null) {
  const tenantId = randomUUID();
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: "Workspace",
    createdAt: now,
    updatedAt: now,
  });
  const owner = await createUser({ email: `${tenantId}@example.test` });
  await addTenantMember(tenantId, owner, true);
  const subscriptions = GetModel(TenantSubscriptionModel, tenantId);
  await subscriptions.insert({
    _id: tenantId,
    planId: "pro",
    status: "active",
    isComplimentary: false,
  });
  const billingInfo = GetModel(TenantBillingInfoModel, tenantId);
  if (customerType) await billingInfo.insert({ _id: tenantId, customerType });
  const controller = new SaasTenantPlanController();
  controller.tenantModel = GetModel(TenantModel);
  controller.planModel = GetModel(PlanModel);
  controller.featureModel = GetModel(FeatureModel);
  const current = await controller.getCurrentPlan(
    owner,
    await tenantRequest(owner, tenantId),
    subscriptions,
    billingInfo,
    "en",
  );
  return Object.fromEntries(
    current.available.map((plan) => [plan._id, plan.isOfferedToCustomerType]),
  );
}

describe("plans offered to the workspace's customer type", () => {
  it("marks a business plan as not offered to an individual", async () => {
    await expect(offeredPlans("individual")).resolves.toEqual({
      pro: true,
      team: false,
    });
  });

  it("offers every plan to a business customer", async () => {
    await expect(offeredPlans("business")).resolves.toEqual({
      pro: true,
      team: true,
    });
  });

  it("offers every plan while the customer type is not known", async () => {
    await expect(offeredPlans(null)).resolves.toEqual({
      pro: true,
      team: true,
    });
  });

  it("sells an any-audience plan to both types", () => {
    expect(isPlanOfferedTo({ audience: "any" }, "individual")).toBe(true);
    expect(isPlanOfferedTo({ audience: "business" }, "individual")).toBe(false);
  });
});
