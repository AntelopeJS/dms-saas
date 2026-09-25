import type { User } from "@antelopejs/interface-dms/auth/db";
import { describe, expect, it, vi } from "vitest";
import type {
  TenantBillingInfo,
  TenantBillingInfoModel,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";

const plans = vi.hoisted(() => new Map<string, { audience: string }>());

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: () => ({ get: async (id: string) => plans.get(id) }),
  };
});

const { SaasTenantBillingController } =
  await import("../src/routes/tenant/tenant-billing");
const { findMissingBillingIdentityFields } =
  await import("../src/workspaces/billing-identity");

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

function subscriptionModel(
  subscription?: Partial<TenantSubscription>,
): TenantSubscriptionModel {
  return {
    findOne: vi.fn(async () => subscription),
  } as unknown as TenantSubscriptionModel;
}

const COMPLETE_ADDRESS = {
  country: "BE",
  line1: "Rue Antoine Dansaert 12",
  postalCode: "1000",
  city: "Brussels",
};

const INDIVIDUAL_IDENTITY = {
  customerType: "individual",
  billingEmail: " billing@example.com ",
  address: COMPLETE_ADDRESS,
};

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
      missingFields: [
        "customerType",
        "country",
        "line1",
        "postalCode",
        "city",
        "billingEmail",
      ],
    });
  });

  it("rejects an empty save instead of defaulting the customer type", async () => {
    const controller = new SaasTenantBillingController();
    const store: BillingInfoStore = {};

    await expect(
      controller.updateBillingInfo(
        OWNER,
        {},
        billingModel(store),
        subscriptionModel(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(store.current).toBeUndefined();
  });

  it("creates the billing row from a complete individual identity", async () => {
    const controller = new SaasTenantBillingController();
    const store: BillingInfoStore = {};

    await expect(
      controller.updateBillingInfo(
        OWNER,
        { ...INDIVIDUAL_IDENTITY, companyName: "Ignored SRL" },
        billingModel(store),
        subscriptionModel(),
      ),
    ).resolves.toMatchObject({
      customerType: "individual",
      companyName: null,
      billingEmail: "billing@example.com",
      address: COMPLETE_ADDRESS,
      missingFields: [],
    });
    expect(store.current).toMatchObject({
      customerType: "individual",
      billingEmail: "billing@example.com",
    });
  });

  it("requires a company name for a business", async () => {
    const controller = new SaasTenantBillingController();

    await expect(
      controller.updateBillingInfo(
        OWNER,
        { ...INDIVIDUAL_IDENTITY, customerType: "business", companyName: " " },
        billingModel({}),
        subscriptionModel(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stores a business identity with its VAT number", async () => {
    const controller = new SaasTenantBillingController();
    const store: BillingInfoStore = {};

    await controller.updateBillingInfo(
      OWNER,
      {
        ...INDIVIDUAL_IDENTITY,
        customerType: "business",
        companyName: " Acme SRL ",
        vatNumber: "BE0771234567",
      },
      billingModel(store),
      subscriptionModel(),
    );

    expect(store.current).toMatchObject({
      customerType: "business",
      companyName: "Acme SRL",
      vatNumber: "BE0771234567",
    });
  });

  it("refuses a customer type the plan in force is not open to", async () => {
    plans.set("plan_business", { audience: "business" });
    const controller = new SaasTenantBillingController();

    await expect(
      controller.updateBillingInfo(
        OWNER,
        INDIVIDUAL_IDENTITY,
        billingModel({}),
        subscriptionModel({ planId: "plan_business" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("billing identity completeness", () => {
  it("lists every missing required field in form order", () => {
    expect(findMissingBillingIdentityFields({})).toEqual([
      "customerType",
      "country",
      "line1",
      "postalCode",
      "city",
      "billingEmail",
    ]);
  });

  it("asks a business for its company name but not its VAT number", () => {
    expect(
      findMissingBillingIdentityFields({
        ...INDIVIDUAL_IDENTITY,
        customerType: "business",
      }),
    ).toEqual(["companyName"]);
  });

  it("rejects a malformed e-mail and country", () => {
    expect(
      findMissingBillingIdentityFields({
        ...INDIVIDUAL_IDENTITY,
        billingEmail: "not-an-email",
        address: { ...COMPLETE_ADDRESS, country: "Belgium" },
      }),
    ).toEqual(["country", "billingEmail"]);
  });
});
