import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PlanModel,
  type TenantBillingInfo,
  type TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { isPlanForCustomerType } from "../src/routes/tenant/tenant-plan-ops";

const harness = vi.hoisted(() => ({ tenantId: "" }));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => harness.tenantId,
}));
vi.mock("../src/plans/stripe-sync", async (original) => ({
  ...(await original()),
  ensurePlanStripeRefs: async (plan: unknown) => plan,
}));

const SETUP_TIMEOUT_MS = 60_000;
const PUBLIC_PLAN = {
  isActive: true,
  isPublic: true,
  isDeleted: false,
  price: 29,
  trialDays: 0,
  billingMode: "flat",
  features: [],
};

let mongodb: MongoMemoryReplSet;
beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "saas-plan-audience" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
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
}, SETUP_TIMEOUT_MS);
afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});

function owner(): User {
  return { _id: "owner", owner: false, email: "owner@example.test" } as User;
}

async function offeredPlans(customerType: string | null) {
  harness.tenantId = randomUUID();
  const subscriptions = GetModel(TenantSubscriptionModel, harness.tenantId);
  await subscriptions.insert({
    _id: harness.tenantId,
    planId: "pro",
    status: "active",
    isComplimentary: false,
  });
  const billingInfo = {
    findOne: async () =>
      customerType ? ({ customerType } as TenantBillingInfo) : undefined,
  } as unknown as TenantBillingInfoModel;
  const controller = new SaasTenantPlanController();
  controller.tenantModel = {
    get: async (_id: string) => ({ _id }),
  } as never;
  controller.planModel = GetModel(PlanModel);
  controller.featureModel = { getAll: async () => [] } as never;
  const current = await controller.getCurrentPlan(
    owner(),
    {},
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
    expect(isPlanForCustomerType({ audience: "any" }, "individual")).toBe(true);
    expect(isPlanForCustomerType({ audience: "business" }, "individual")).toBe(
      false,
    );
  });
});
