import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TenantBillingInfo,
  TenantBillingInfoModel,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";

const harness = vi.hoisted(() => ({
  checkout: vi.fn(),
  immediate: vi.fn(),
  downgrade: vi.fn(),
  price: 49,
}));
vi.mock("@antelopejs/interface-dms/tenant-access", () => ({
  AssertTenantAccess: async () => undefined,
}));
vi.mock("../src/routes/tenant/tenant-plan-checkout", () => ({
  startPaidCheckout: (...args: unknown[]) => harness.checkout(...args),
}));
vi.mock("../src/routes/tenant/tenant-plan-ops", async (original) => ({
  ...(await original()),
  loadAndValidateTargetPlan: async () => ({
    _id: "target-plan",
    price: harness.price,
    billingMode: "flat",
    paymentProviderRefs: harness.price > 0 ? { stripePriceId: "price" } : null,
  }),
  assertSeatLimit: async () => undefined,
  applyImmediateChange: (...args: unknown[]) => harness.immediate(...args),
  scheduleDowngrade: (...args: unknown[]) => harness.downgrade(...args),
}));

const OWNER = { _id: "owner", owner: false } as User;
const FREE = {
  planId: "free-plan",
  isComplimentary: false,
  status: "active",
  freeUntil: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
} as TenantSubscription;
const PAID = {
  ...FREE,
  planId: "paid-plan",
  stripeCustomerId: "customer",
  stripeSubscriptionId: "subscription",
} as TenantSubscription;
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
} as TenantBillingInfo;
const INCOMPLETE_IDENTITIES: [string, TenantBillingInfo | undefined][] = [
  ["no stored identity", undefined],
  ["no address", { ...COMPLETE_IDENTITY, address: null } as TenantBillingInfo],
  [
    "a business without a company name",
    { ...COMPLETE_IDENTITY, customerType: "business" } as TenantBillingInfo,
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
  harness.price = 49;
  harness.checkout.mockResolvedValue({
    checkoutUrl: "https://checkout.example.test",
  });
  harness.immediate.mockResolvedValue({ changed: true });
  harness.downgrade.mockResolvedValue({ scheduled: true });
});

function change(
  subscription: TenantSubscription,
  billingInfo: TenantBillingInfo | undefined,
) {
  const controller = new SaasTenantPlanController();
  controller.tenantModel = { get: async () => ({ _id: "tenant" }) } as never;
  controller.planModel = {
    get: async (_id: string) => ({
      _id,
      price: _id === "paid-plan" ? 19 : 0,
      paymentProviderRefs:
        _id === "paid-plan" ? { stripePriceId: "current" } : null,
    }),
  } as never;
  const subscriptions = {
    findOne: async () => subscription,
  } as TenantSubscriptionModel;
  const billing = {
    findOne: async () => billingInfo,
  } as TenantBillingInfoModel;
  return controller.changePlan(
    OWNER,
    { planId: "target-plan" },
    {},
    subscriptions,
    billing,
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
      expect(harness.checkout).not.toHaveBeenCalled();
    },
  );

  it("starts checkout once the identity is complete", async () => {
    await expect(change(FREE, COMPLETE_IDENTITY)).resolves.toMatchObject({
      checkoutUrl: "https://checkout.example.test",
    });
    expect(harness.checkout).toHaveBeenCalledOnce();
  });

  it("leaves paid to paid changes to the live subscription", async () => {
    await expect(change(PAID, undefined)).resolves.toMatchObject({
      changed: true,
    });
    expect(harness.immediate).toHaveBeenCalledOnce();
    expect(harness.checkout).not.toHaveBeenCalled();
  });

  it("leaves downgrades to a free plan alone", async () => {
    harness.price = 0;
    await expect(change(PAID, undefined)).resolves.toMatchObject({
      scheduled: true,
    });
    expect(harness.downgrade).toHaveBeenCalledOnce();
  });
});
