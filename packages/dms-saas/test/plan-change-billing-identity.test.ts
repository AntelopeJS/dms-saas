import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanModel,
  type TenantBillingInfo,
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

useMongoDatabase("plan-change-billing-identity");
useDmsAuth();
const stripe = useSuiteStripe();

const CHECKOUT_URL = "https://checkout.example.test";
const FREE = {
  planId: "free-plan",
  isComplimentary: false,
  status: "active",
  freeUntil: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
} satisfies Partial<TenantSubscription>;
const PAID = {
  ...FREE,
  planId: "paid-plan",
  stripeCustomerId: "customer",
  stripeSubscriptionId: "subscription",
} satisfies Partial<TenantSubscription>;
const COMPLETE_IDENTITY = {
  customerType: "individual",
  companyName: null,
  vatNumber: null,
  billingEmail: "billing@example.test",
  address: {
    line1: "1 rue de la Paix",
    line2: null,
    postalCode: "75002",
    city: "Paris",
    state: null,
    country: "FR",
  },
} satisfies Partial<TenantBillingInfo>;
const CUSTOMER_TYPE_ONLY = {
  customerType: "individual",
} satisfies Partial<TenantBillingInfo>;
const INCOMPLETE_IDENTITIES: [string, Partial<TenantBillingInfo>][] = [
  ["no stored identity", CUSTOMER_TYPE_ONLY],
  ["no address", { ...COMPLETE_IDENTITY, address: null }],
  [
    "a business without a company name",
    { ...COMPLETE_IDENTITY, customerType: "business" },
  ],
];

beforeAll(async () => {
  allowCheckoutRedirects();
  await insertPlan({ _id: "free-plan" });
  await insertPlan({
    _id: "paid-plan",
    price: 19,
    paymentProviderRefs: { stripePriceId: "price_current" },
  });
  await insertPlan({
    _id: "target-plan",
    price: 49,
    paymentProviderRefs: { stripePriceId: "price_target" },
  });
});

function stubStripe() {
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockResolvedValue(
    fromPartial({ items: { data: [{ id: "si_current" }] } }),
  );
  return {
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "cus_new" })),
    createSession: vi
      .spyOn(stripe.write.checkout.sessions, "create")
      .mockResolvedValue(fromPartial({ id: "cs_1", url: CHECKOUT_URL })),
    updateSubscription: vi
      .spyOn(stripe.write.subscriptions, "update")
      .mockResolvedValue(
        fromPartial({
          items: { data: [{ current_period_end: 1_790_000_000 }] },
        }),
      ),
  };
}

let calls: ReturnType<typeof stubStripe>;

beforeEach(() => {
  calls = stubStripe();
});

async function change(
  subscription: Partial<TenantSubscription>,
  billingInfo: Partial<TenantBillingInfo>,
  planId = "target-plan",
) {
  const { tenantId, owner, request } = await createOwnedWorkspace();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    paidUsagePeriods: [],
    ...subscription,
  });
  await GetModel(TenantBillingInfoModel, tenantId).insert({
    _id: tenantId,
    updatedAt: new Date(),
    ...billingInfo,
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

describe("free to paid plan change requires a complete billing identity", () => {
  it.each(INCOMPLETE_IDENTITIES)(
    "refuses checkout with %s",
    async (_label, billingInfo) => {
      await expect(change(FREE, billingInfo)).rejects.toMatchObject({
        status: 400,
        body: "saas.errors.billing.identity_incomplete",
      });
      expect(calls.createSession).not.toHaveBeenCalled();
      expect(calls.createCustomer).not.toHaveBeenCalled();
    },
  );

  it("starts checkout once the identity is complete", async () => {
    await expect(change(FREE, COMPLETE_IDENTITY)).resolves.toMatchObject({
      checkoutUrl: CHECKOUT_URL,
    });
    expect(calls.createSession).toHaveBeenCalledOnce();
  });

  it("leaves paid to paid changes to the live subscription", async () => {
    await expect(change(PAID, CUSTOMER_TYPE_ONLY)).resolves.toMatchObject({
      changed: true,
    });
    expect(calls.updateSubscription).toHaveBeenCalledOnce();
    expect(calls.updateSubscription).toHaveBeenCalledWith(
      "subscription",
      expect.objectContaining({
        items: [{ id: "si_current", price: "price_target", quantity: 1 }],
      }),
      expect.anything(),
    );
    expect(calls.createSession).not.toHaveBeenCalled();
  });

  it("leaves downgrades to a free plan alone", async () => {
    await expect(
      change(PAID, CUSTOMER_TYPE_ONLY, "free-plan"),
    ).resolves.toMatchObject({
      scheduled: true,
    });
    expect(calls.updateSubscription).toHaveBeenCalledOnce();
    expect(calls.updateSubscription).toHaveBeenCalledWith("subscription", {
      cancel_at_period_end: true,
    });
  });
});
