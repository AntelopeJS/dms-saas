import { ImplementInterface } from "@antelopejs/interface-core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface ModelClass {
  name: string;
}

const harness = vi.hoisted(() => ({
  isMember: true,
  assertTenantAccess: vi.fn(),
  getPreview: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: (model: ModelClass, tenantId: string) => {
    harness.getModel(model.name, tenantId);
    return {
      getByUser: async () =>
        harness.isMember ? { isTenantOwner: false } : undefined,
    };
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
  retrieveStripeCustomerBalance: vi.fn(),
}));
vi.mock("../src/upcoming-invoice/preview", () => ({
  getUpcomingInvoicePreview: (...args: unknown[]) =>
    harness.getPreview(...args),
}));

import * as billingImplementation from "../src/implementations/dms-saas/billing";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";

const SCOPE = { tenantId: "tenant-current", userId: "user-member" };
const PREVIEW = {
  status: "absent",
  reason: "free_plan",
  computedAt: "2026-09-15T12:00:00.000Z",
};

beforeAll(() => {
  ImplementInterface(billingInterface, billingImplementation);
});

beforeEach(() => {
  harness.isMember = true;
  harness.assertTenantAccess.mockReset().mockResolvedValue(undefined);
  harness.getPreview.mockReset().mockResolvedValue(PREVIEW);
  harness.getModel.mockReset();
});

describe("upcoming invoice preview interface", () => {
  it("returns the preview of the authorized scope's tenant", async () => {
    await expect(
      billingInterface.GetUpcomingInvoicePreview(SCOPE),
    ).resolves.toEqual(PREVIEW);
    expect(harness.getPreview).toHaveBeenCalledWith("tenant-current");
    expect(harness.getModel).toHaveBeenCalledWith(
      "TenantMemberModel",
      "tenant-current",
    );
    expect(harness.assertTenantAccess).toHaveBeenCalledWith(
      "user-member",
      "tenant-current",
    );
  });

  it("rejects authenticated non-members before reading billing", async () => {
    harness.isMember = false;

    await expect(
      billingInterface.GetUpcomingInvoicePreview(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(harness.getPreview).not.toHaveBeenCalled();
  });

  it("honors the current tenant access gate before reading billing", async () => {
    harness.assertTenantAccess.mockRejectedValue({ status: 403 });

    await expect(
      billingInterface.GetUpcomingInvoicePreview(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(harness.getPreview).not.toHaveBeenCalled();
  });
});
