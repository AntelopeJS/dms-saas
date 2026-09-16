import type { User } from "@antelopejs/interface-dms/auth/db";
import { describe, expect, it, vi } from "vitest";
import type {
  TenantBillingInfo,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasTenantBillingController } from "../src/routes/tenant/tenant-billing";

interface BillingInfoWrite {
  customerType: "individual" | "business" | null;
  companyName: string | null;
  vatNumber: string | null;
  vatVerificationStatus: "pending" | "verified" | "unverified" | null;
  billingEmail: string | null;
  address: TenantBillingInfo["address"];
  updatedAt: Date;
}

interface BillingInfoStore {
  current?: TenantBillingInfo;
}

const OWNER = { name: "Workspace Owner" } as User;

function billingModel(store: BillingInfoStore): TenantBillingInfoModel {
  return {
    findOne: vi.fn(async () => store.current),
    insert: vi.fn(async (rows: BillingInfoWrite[]) => {
      store.current = { _id: "billing-info", ...rows[0] } as TenantBillingInfo;
      return ["billing-info"];
    }),
    update: vi.fn(async () => undefined),
  } as unknown as TenantBillingInfoModel;
}

function subscriptionModel(): TenantSubscriptionModel {
  return {
    findOne: vi.fn(async () => undefined),
  } as unknown as TenantSubscriptionModel;
}

describe("tenant billing information", () => {
  it("returns an empty editable profile when no billing row exists", async () => {
    const controller = new SaasTenantBillingController();

    await expect(
      controller.getBillingInfo(OWNER, billingModel({}), subscriptionModel()),
    ).resolves.toEqual({
      customerType: null,
      companyName: null,
      vatNumber: null,
      vatVerificationStatus: null,
      billingEmail: null,
      address: null,
    });
  });

  it("creates the billing row when an owner saves the empty profile", async () => {
    const controller = new SaasTenantBillingController();
    const store: BillingInfoStore = {};

    await expect(
      controller.updateBillingInfo(
        OWNER,
        {
          billingEmail: " billing@example.com ",
          address: { country: "BE", city: "Brussels" },
        },
        billingModel(store),
        subscriptionModel(),
      ),
    ).resolves.toMatchObject({
      customerType: "individual",
      billingEmail: "billing@example.com",
      address: {
        country: "BE",
        city: "Brussels",
      },
    });
    expect(store.current).toMatchObject({
      customerType: "individual",
      billingEmail: "billing@example.com",
    });
  });
});
