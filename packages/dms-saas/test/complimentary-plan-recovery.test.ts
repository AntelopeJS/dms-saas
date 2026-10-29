import { GetModel } from "@antelopejs/interface-database-decorators";
import { RegisterTenantAccessGate } from "@antelopejs/interface-dms/tenant-access";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerSubscriptionAccessGate,
  WORKSPACE_ACCESS_BLOCKED_CODE,
} from "../src/auth/subscription-access-gate";
import {
  PlanModel,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import {
  allowCheckoutRedirects,
  createOwnedWorkspace,
} from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("complimentary-plan-recovery");
useDmsAuth();
const stripe = useSuiteStripe();

const CHECKOUT_URL = "https://checkout.example.test";
const NOW = new Date();
const GIFT = {
  planId: "same-plan",
  isComplimentary: true,
  status: "suspended",
  freeUntil: new Date(NOW.getTime() - 60_000),
  stripeCustomerId: "customer",
  stripeSubscriptionId: null,
} satisfies Partial<TenantSubscription>;

beforeAll(async () => {
  allowCheckoutRedirects();
  registerSubscriptionAccessGate();
  RegisterTenantAccessGate({
    id: "suite.every-workspace-blocked",
    order: 200,
    gate: async () => ({ allowed: false, code: WORKSPACE_ACCESS_BLOCKED_CODE }),
  });
  await insertPlan({
    _id: "same-plan",
    price: 49,
    paymentProviderRefs: { stripePriceId: "price" },
  });
  await insertPlan({ _id: "free-plan" });
});

let createSession: ReturnType<typeof stubCheckout>;

function stubCheckout() {
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(fromPartial({}));
  return vi
    .spyOn(stripe.write.checkout.sessions, "create")
    .mockResolvedValue(fromPartial({ id: "cs_1", url: CHECKOUT_URL }));
}

beforeEach(() => {
  createSession = stubCheckout();
});

async function change(
  subscription: Partial<TenantSubscription>,
  planId = "same-plan",
) {
  const { tenantId, owner, request } = await createOwnedWorkspace();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    paidUsagePeriods: [],
    ...subscription,
  });
  await GetModel(TenantBillingInfoModel, tenantId).insert({
    _id: tenantId,
    customerType: "individual",
    updatedAt: new Date(),
  });
  const controller = new SaasTenantPlanController();
  controller.tenantModel = GetModel(TenantModel);
  controller.planModel = GetModel(PlanModel);
  return controller.changePlan(
    owner,
    {
      planId,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
    request,
    GetModel(TenantSubscriptionModel, tenantId),
    GetModel(TenantBillingInfoModel, tenantId),
  );
}

describe("complimentary plan recovery controller", () => {
  it.each(["active", "past_due", "suspended"] as const)(
    "starts checkout for the same expired plan in %s even with access blocked",
    async (status) => {
      await expect(change({ ...GIFT, status })).resolves.toMatchObject({
        checkoutUrl: CHECKOUT_URL,
      });
      expect(createSession).toHaveBeenCalledOnce();
    },
  );

  it("refuses live complimentary plan changes independently of suspension/admission", async () => {
    await expect(
      change({ ...GIFT, freeUntil: null, status: "active" }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.complimentary_locked",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("cannot use complimentary recovery to escape a real unpaid paid subscription", async () => {
    await expect(
      change({ ...GIFT, isComplimentary: false, stripeSubscriptionId: "paid" }),
    ).rejects.toMatchObject({
      status: 403,
      body: WORKSPACE_ACCESS_BLOCKED_CODE,
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not permit free-plan selection as a way around suspension", async () => {
    await expect(change(GIFT, "free-plan")).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.paid_recovery_required",
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
