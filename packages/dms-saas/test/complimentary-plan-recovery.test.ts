import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TenantSubscription,
  TenantSubscriptionModel,
  TenantBillingInfoModel,
} from "../src/db";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";

const harness = vi.hoisted(() => ({
  checkout: vi.fn(),
  assertAccess: vi.fn(),
  price: 49,
}));
vi.mock("@antelopejs/interface-dms/tenant-access", () => ({
  AssertTenantAccess: (...args: unknown[]) => harness.assertAccess(...args),
}));
vi.mock("../src/routes/tenant/tenant-plan-ops", async (original) => ({
  ...(await original()),
  loadAndValidateTargetPlan: async () => ({
    _id: "same-plan",
    price: harness.price,
    billingMode: "flat",
    paymentProviderRefs: harness.price > 0 ? { stripePriceId: "price" } : null,
  }),
  assertSeatLimit: async () => undefined,
  startPaidCheckout: (...args: unknown[]) => harness.checkout(...args),
}));

const OWNER = { _id: "owner", owner: false } as User;
const NOW = new Date();
const GIFT = {
  planId: "same-plan",
  isComplimentary: true,
  status: "suspended",
  freeUntil: new Date(NOW.getTime() - 60_000),
  stripeCustomerId: "customer",
  stripeSubscriptionId: null,
} as TenantSubscription;

beforeEach(() => {
  vi.clearAllMocks();
  harness.price = 49;
  harness.assertAccess.mockRejectedValue(
    new Error("Paid suspension remains blocked"),
  );
  harness.checkout.mockResolvedValue({
    checkoutUrl: "https://checkout.example.test",
  });
});

function change(subscription: TenantSubscription) {
  const controller = new SaasTenantPlanController();
  controller.tenantModel = { get: async () => ({ _id: "tenant" }) } as never;
  const subscriptions = {
    findOne: async () => subscription,
  } as TenantSubscriptionModel;
  const billingInfo = {
    findOne: async () => undefined,
  } as TenantBillingInfoModel;
  return controller.changePlan(
    OWNER,
    { planId: "same-plan" },
    {},
    subscriptions,
    billingInfo,
  );
}

describe("complimentary plan recovery controller", () => {
  it.each(["active", "past_due", "suspended"])(
    "starts checkout for the same expired plan in %s even with access blocked",
    async (status) => {
      await expect(
        change({ ...GIFT, status } as TenantSubscription),
      ).resolves.toMatchObject({
        checkoutUrl: "https://checkout.example.test",
      });
      expect(harness.checkout).toHaveBeenCalledOnce();
      expect(harness.assertAccess).not.toHaveBeenCalled();
    },
  );

  it("refuses live complimentary plan changes independently of suspension/admission", async () => {
    await expect(
      change({ ...GIFT, freeUntil: null, status: "active" }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.complimentary_locked",
    });
    expect(harness.checkout).not.toHaveBeenCalled();
  });

  it("cannot use complimentary recovery to escape a real unpaid paid subscription", async () => {
    await expect(
      change({ ...GIFT, isComplimentary: false, stripeSubscriptionId: "paid" }),
    ).rejects.toThrow("Paid suspension remains blocked");
    expect(harness.checkout).not.toHaveBeenCalled();
  });

  it("does not permit free-plan selection as a way around suspension", async () => {
    harness.price = 0;
    await expect(change(GIFT)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.paid_recovery_required",
    });
    expect(harness.checkout).not.toHaveBeenCalled();
  });
});
