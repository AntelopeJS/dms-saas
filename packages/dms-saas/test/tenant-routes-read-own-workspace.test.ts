import { randomUUID } from "node:crypto";
import { fromPartial } from "@total-typescript/shoehorn";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as auth from "@antelopejs/interface-dms/auth";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InvoiceModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { tenantInvoicesDataAPI } from "../src/data-api/tenant/tenant-invoices";
import "../src/routes/tenant/tenant-billing";
import "../src/routes/tenant/tenant-plan";
import "../src/routes/tenant/tenant-seats";
import { addTenantMember, createUser, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import {
  callRoute,
  registeredRoute,
  resolvedController,
} from "./helpers/routes";

useMongoDatabase();
useDmsAuth();

/** Rows of a workspace, told apart from the default workspace's by every value. */
async function seedWorkspace(
  tenantId: string,
  planId: string,
  customerType: TenantBillingInfo["customerType"],
  invoiceNumbers: string[],
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId,
    status: "active",
    isComplimentary: false,
  });
  if (customerType) {
    await GetModel(TenantBillingInfoModel, tenantId).insert({
      _id: tenantId,
      customerType,
    });
  }
  for (const number of invoiceNumbers) {
    await GetModel(InvoiceModel, tenantId).insert({
      _id: randomUUID(),
      documentType: "invoice",
      stripeInvoiceId: `in_${number}`,
      stripeCreditNoteId: null,
      number,
    });
  }
}

beforeAll(async () => {
  await insertPlan({
    isPublic: true,
    _id: "free",
    name: "Free",
    order: 1,
    maxMembers: 1,
  });
  await insertPlan({
    isPublic: true,
    _id: "pro",
    name: "Pro",
    order: 2,
    maxMembers: 5,
  });
  await insertPlan({
    isPublic: true,
    _id: "team",
    audience: "business",
    order: 3,
  });
  await seedWorkspace(DEFAULT_TENANT_ID, "free", null, [
    "DEFAULT-1",
    "DEFAULT-2",
  ]);
});

/**
 * A fresh request of the owner of a new workspace on `pro`, with an
 * individual customer type and one invoice, as the browser sends it: only the
 * bearer token, the tenant not resolved yet.
 */
async function ownerRequest(): Promise<RequestContext> {
  const tenantId = randomUUID();
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: "Workspace",
    createdAt: now,
    updatedAt: now,
  });
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  await seedWorkspace(tenantId, "pro", "individual", ["OWN-1"]);
  const { token } = await auth.generateAccessToken(tenantId, owner);
  return fromPartial<RequestContext>({
    rawRequest: { headers: { authorization: `Bearer ${token}` } },
  });
}

/** A plan list holding the business-only plan, not offered to an individual. */
const BUSINESS_PLAN_NOT_OFFERED: unknown = expect.arrayContaining([
  expect.objectContaining({ _id: "team", isOfferedToCustomerType: false }),
]);

describe("tenant routes read the caller's workspace", () => {
  it("answers the plan page with the workspace's plan and customer type", async () => {
    await expect(
      callRoute("GET", "/api/saas/tenant/plan/", await ownerRequest()),
    ).resolves.toMatchObject({
      current: { _id: "pro" },
      available: BUSINESS_PLAN_NOT_OFFERED,
    });
  });

  it("answers the billing information of the workspace", async () => {
    await expect(
      callRoute("GET", "/api/saas/tenant/billing-info", await ownerRequest()),
    ).resolves.toMatchObject({ customerType: "individual" });
  });

  it("answers the seat quota of the workspace's plan", async () => {
    await expect(
      callRoute("GET", "/api/saas/tenant/seats/", await ownerRequest()),
    ).resolves.toMatchObject({ planName: "Pro", maxMembers: 5 });
  });

  it("lists the workspace's own invoices in its invoices table", async () => {
    const controller = await resolvedController(
      registeredRoute("GET", "/api/saas/tenant/tables/invoices/list"),
      await ownerRequest(),
    );
    expect(controller).toBeInstanceOf(tenantInvoicesDataAPI);
    if (!(controller instanceof tenantInvoicesDataAPI)) return;
    const invoices = await controller.model.getAll();
    expect(invoices.map((invoice) => invoice.number)).toEqual(["OWN-1"]);
  });
});
