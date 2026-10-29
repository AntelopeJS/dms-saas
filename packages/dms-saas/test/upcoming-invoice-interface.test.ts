import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import * as billingImplementation from "../src/implementations/dms-saas/billing";
import { addTenantMember, useTenantAccessGate } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("upcoming-invoice-interface");
const gate = useTenantAccessGate();

const FREE_PLAN_ID = "free";

/** The scope of the current test: a member of a workspace on the free plan. */
let SCOPE = { tenantId: "", userId: "" };

/** Watches the reads of the scope's workspace billing. */
function billingReads() {
  return vi.spyOn(GetModel(TenantSubscriptionModel, SCOPE.tenantId), "findOne");
}

beforeAll(async () => {
  ImplementInterface(billingInterface, billingImplementation);
  await GetModel(PlanModel).insert({ _id: FREE_PLAN_ID, price: 0 });
});

beforeEach(async () => {
  SCOPE = { tenantId: randomUUID(), userId: randomUUID() };
  await addTenantMember(
    SCOPE.tenantId,
    fromPartial<User>({ _id: SCOPE.userId }),
  );
  await GetModel(TenantSubscriptionModel, SCOPE.tenantId).insert({
    _id: SCOPE.tenantId,
    planId: FREE_PLAN_ID,
    status: "active",
  });
  gate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upcoming invoice preview interface", () => {
  it("returns the preview of the authorized scope's tenant", async () => {
    await expect(
      billingInterface.GetUpcomingInvoicePreview(SCOPE),
    ).resolves.toEqual({
      status: "absent",
      reason: "free_plan",
      computedAt: expect.any(String),
    });
    expect(gate).toHaveBeenCalledWith(SCOPE.userId, SCOPE.tenantId);
  });

  it("rejects authenticated non-members before reading billing", async () => {
    const reads = billingReads();

    await expect(
      billingInterface.GetUpcomingInvoicePreview({
        ...SCOPE,
        userId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(reads).not.toHaveBeenCalled();
  });

  it("honors the current tenant access gate before reading billing", async () => {
    const reads = billingReads();
    gate.mockReturnValueOnce({ allowed: false, code: "suspended" });

    await expect(
      billingInterface.GetUpcomingInvoicePreview(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(reads).not.toHaveBeenCalled();
  });
});
