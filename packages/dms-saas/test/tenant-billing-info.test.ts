import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasTenantBillingController } from "../src/routes/tenant/tenant-billing";
import { findMissingBillingIdentityFields } from "../src/workspaces/billing-identity";
import {
  addTenantMember,
  createUser,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("tenant-billing-info");
useDmsAuth();

interface Workspace {
  tenantId: string;
  owner: User;
  request: RequestContext;
  billing: TenantBillingInfoModel;
  subscriptions: TenantSubscriptionModel;
}

let workspace: Workspace;

beforeEach(async () => {
  const tenantId = randomUUID();
  const owner = await createUser({ name: "Workspace Owner" });
  await addTenantMember(tenantId, owner, true);
  workspace = {
    tenantId,
    owner,
    request: await tenantRequest(owner, tenantId),
    billing: GetModel(TenantBillingInfoModel, tenantId),
    subscriptions: GetModel(TenantSubscriptionModel, tenantId),
  };
});

function updateBillingInfo(body: object) {
  return new SaasTenantBillingController().updateBillingInfo(
    workspace.request,
    workspace.owner,
    body,
    workspace.billing,
    workspace.subscriptions,
  );
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
    await expect(
      new SaasTenantBillingController().getBillingInfo(
        workspace.owner,
        workspace.billing,
        workspace.subscriptions,
      ),
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
      updatedAt: null,
    });
  });

  it("rejects an empty save instead of defaulting the customer type", async () => {
    await expect(updateBillingInfo({})).rejects.toMatchObject({ status: 400 });
    await expect(workspace.billing.findOne()).resolves.toBeUndefined();
  });

  it("creates the billing row from a complete individual identity", async () => {
    await expect(
      updateBillingInfo({ ...INDIVIDUAL_IDENTITY, companyName: "Ignored SRL" }),
    ).resolves.toMatchObject({
      customerType: "individual",
      companyName: null,
      billingEmail: "billing@example.com",
      address: COMPLETE_ADDRESS,
      missingFields: [],
    });
    await expect(workspace.billing.findOne()).resolves.toMatchObject({
      customerType: "individual",
      billingEmail: "billing@example.com",
    });
  });

  it("keys the first billing row by the tenant", async () => {
    await updateBillingInfo(INDIVIDUAL_IDENTITY);

    expect((await workspace.billing.findOne())?._id).toBe(workspace.tenantId);
  });

  it("turns a racing first save into an update of the same row", async () => {
    await workspace.billing.insert({
      _id: workspace.tenantId,
      customerType: "business",
      companyName: "Concurrent SRL",
      updatedAt: new Date(),
    });
    const update = vi.spyOn(workspace.billing, "update");
    vi.spyOn(workspace.billing, "findOne").mockResolvedValueOnce(undefined);

    await updateBillingInfo(INDIVIDUAL_IDENTITY);

    expect(update).toHaveBeenCalledWith(
      workspace.tenantId,
      expect.objectContaining({ customerType: "individual" }),
    );
    await expect(
      workspace.billing.get(workspace.tenantId),
    ).resolves.toMatchObject({
      _id: workspace.tenantId,
      customerType: "individual",
      billingEmail: "billing@example.com",
    });
  });

  it("requires a company name for a business", async () => {
    await expect(
      updateBillingInfo({
        ...INDIVIDUAL_IDENTITY,
        customerType: "business",
        companyName: " ",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stores a business identity with its VAT number", async () => {
    await updateBillingInfo({
      ...INDIVIDUAL_IDENTITY,
      customerType: "business",
      companyName: " Acme SRL ",
      vatNumber: "BE0771234567",
    });

    await expect(workspace.billing.findOne()).resolves.toMatchObject({
      customerType: "business",
      companyName: "Acme SRL",
      vatNumber: "BE0771234567",
    });
  });

  it("refuses a customer type the plan in force is not open to", async () => {
    const planId = randomUUID();
    await GetModel(PlanModel).insert({ _id: planId, audience: "business" });
    await workspace.subscriptions.insert({
      _id: workspace.tenantId,
      planId,
      status: "active",
    });

    await expect(updateBillingInfo(INDIVIDUAL_IDENTITY)).rejects.toMatchObject({
      status: 400,
    });
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
