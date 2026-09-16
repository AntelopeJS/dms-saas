import { ImplementInterface } from "@antelopejs/interface-core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface ModelClass {
  name: string;
}

interface SubscriptionFixture {
  stripeCustomerId?: string;
  isComplimentary?: boolean;
}

interface BalanceFixture {
  status: "available" | "deleted";
  balanceMinorUnits: number | null;
  currency: string | null;
}

const harness = vi.hoisted(() => ({
  tenantId: "tenant-current",
  userId: "user-owner",
  isMember: true,
  subscription: { stripeCustomerId: "cus_current" } as SubscriptionFixture,
  assertTenantAccess: vi.fn(),
  retrieveBalance: vi.fn<() => Promise<BalanceFixture>>(),
  getModel: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: (model: ModelClass, tenantId: string) => {
    harness.getModel(model.name, tenantId);
    if (model.name === "TenantMemberModel") {
      return {
        getByUser: async () =>
          harness.isMember ? { isTenantOwner: false } : undefined,
      };
    }
    return { findOne: async () => harness.subscription };
  },
}));

vi.mock("@antelopejs/interface-dms/db", () => ({
  TenantMemberModel: class TenantMemberModel {},
}));
vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn() },
}));
vi.mock("@antelopejs/interface-dms/tenant-access", () => ({
  AssertTenantAccess: (...args: unknown[]) =>
    harness.assertTenantAccess(...args),
}));
vi.mock("../src/db", () => ({
  TenantSubscriptionModel: class TenantSubscriptionModel {},
}));
vi.mock("../src/stripe/customer-balance", () => ({
  retrieveStripeCustomerBalance: (...args: unknown[]) =>
    harness.retrieveBalance(...args),
}));

import * as billingImplementation from "../src/implementations/dms-saas/billing";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";

const SCOPE = { tenantId: "tenant-current", userId: "user-owner" };

beforeAll(() => {
  ImplementInterface(billingInterface, billingImplementation);
});

beforeEach(() => {
  harness.isMember = true;
  harness.subscription = { stripeCustomerId: "cus_current" };
  harness.assertTenantAccess.mockReset().mockResolvedValue(undefined);
  harness.retrieveBalance.mockReset().mockResolvedValue({
    status: "available",
    balanceMinorUnits: 0,
    currency: "eur",
  });
  harness.getModel.mockReset();
});

describe("tenant customer balance interface", () => {
  it("does not query Stripe for a complimentary grant retaining a customer", async () => {
    harness.subscription = {
      stripeCustomerId: "cus_current",
      isComplimentary: true,
    };
    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toMatchObject({ status: "absent", reason: "complimentary" });
    expect(harness.retrieveBalance).not.toHaveBeenCalled();
  });

  it.each([1_250, 0, -1_250])(
    "returns Stripe balance %i in minor units with an explicit currency",
    async (balanceMinorUnits) => {
      harness.retrieveBalance.mockResolvedValue({
        status: "available",
        balanceMinorUnits,
        currency: "eur",
      });

      await expect(
        billingInterface.GetTenantCustomerBalance(SCOPE),
      ).resolves.toEqual({
        status: "available",
        balanceMinorUnits,
        currency: "EUR",
      });
    },
  );

  it("returns explicit absence when no Stripe customer is configured", async () => {
    harness.subscription = {};

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toEqual({
      status: "absent",
      reason: "customer_not_configured",
      balanceMinorUnits: null,
      currency: null,
    });
    expect(harness.retrieveBalance).not.toHaveBeenCalled();
  });

  it("returns explicit absence for a deleted Stripe customer", async () => {
    harness.retrieveBalance.mockResolvedValue({
      status: "deleted",
      balanceMinorUnits: null,
      currency: null,
    });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toMatchObject({ status: "absent", reason: "customer_deleted" });
  });

  it("does not expose a balance without its Stripe currency", async () => {
    harness.retrieveBalance.mockResolvedValue({
      status: "available",
      balanceMinorUnits: -500,
      currency: null,
    });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toEqual({
      status: "absent",
      reason: "currency_unavailable",
      balanceMinorUnits: null,
      currency: null,
    });
  });

  it("fails with a sanitized provider error", async () => {
    harness.retrieveBalance.mockRejectedValue(new Error("provider details"));

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).rejects.toMatchObject({
      status: 502,
      body: "saas.errors.billing.customer_balance_provider_unavailable",
    });
  });

  it("scopes models and access checks to the supplied authenticated scope", async () => {
    await billingInterface.GetTenantCustomerBalance(SCOPE);

    expect(harness.getModel).toHaveBeenCalledWith(
      "TenantMemberModel",
      "tenant-current",
    );
    expect(harness.getModel).toHaveBeenCalledWith(
      "TenantSubscriptionModel",
      "tenant-current",
    );
    expect(harness.assertTenantAccess).toHaveBeenCalledWith(
      "user-owner",
      "tenant-current",
    );
  });

  it("rejects authenticated non-members before reading Stripe", async () => {
    harness.isMember = false;

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(harness.retrieveBalance).not.toHaveBeenCalled();
  });

  it("honors the current tenant access gate before reading Stripe", async () => {
    harness.assertTenantAccess.mockRejectedValue({ status: 403 });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(harness.retrieveBalance).not.toHaveBeenCalled();
  });
});
