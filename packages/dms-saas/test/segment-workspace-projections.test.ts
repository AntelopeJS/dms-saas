import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE, Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InvoiceModel,
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
  tenantSubscriptionsTableName,
} from "../src/db";
import {
  loadAllTenantProjections,
  loadWorkspaceProjection,
} from "../src/utils/segment-matching";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { useQueryGate } from "./helpers/query-gate";
import { insertTenant, seatMembers } from "./helpers/workspaces";

useMongoDatabase();
const gate = useQueryGate();

const NOW = new Date("2026-10-07T12:00:00Z");
const EARLIER = new Date("2026-09-01T00:00:00Z");
const LATER = new Date("2026-10-01T00:00:00Z");

async function createWorkspace(): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await Schema.get(TENANT_SCHEMA_NAME)!.createInstance(tenantId).run();
  return tenantId;
}

async function invoice(
  tenantId: string,
  documentType: "invoice" | "credit_note",
  amount: number,
): Promise<void> {
  await GetModel(InvoiceModel, tenantId).insert({
    _id: randomUUID(),
    documentType,
    status: "paid",
    amount,
    total: amount,
    currency: "eur",
    issuedAt: EARLIER,
    lines: [],
  });
}

/**
 * A workspace whose records changed: a subscription and billing details
 * written before the ones that replaced them, invoices and a credit note,
 * members.
 */
async function createChangedWorkspace(): Promise<void> {
  const tenantId = await createWorkspace();
  const subscriptions = GetModel(TenantSubscriptionModel, tenantId);
  const billingInfos = GetModel(TenantBillingInfoModel, tenantId);
  vi.setSystemTime(EARLIER);
  await subscriptions.insert({ planId: "pro", status: "past_due" });
  await billingInfos.insert({ _id: randomUUID(), customerType: "business" });
  vi.setSystemTime(LATER);
  await subscriptions.insert({ planId: "free", status: "active" });
  await billingInfos.insert({ _id: randomUUID(), customerType: "individual" });
  await invoice(tenantId, "invoice", 4_900);
  await invoice(tenantId, "credit_note", 1_000);
  await seatMembers(tenantId, 3);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await insertPlan({ _id: "free", price: 0 });
  await insertPlan({ _id: "pro", price: 29 });
  await createChangedWorkspace();
  await createChangedWorkspace();
  const bare = await createWorkspace();
  await GetModel(TenantSubscriptionModel, bare).insert({
    planId: "pro",
    status: "trialing",
  });
  vi.useRealTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the projections of every workspace", () => {
  it("projects each workspace as it projects it alone", async () => {
    const planModel = GetModel(PlanModel);
    const tenants = await GetModel(TenantModel, CROSS_INSTANCE).getAll();
    const alone = await Promise.all(
      tenants.map((tenant) => loadWorkspaceProjection(tenant, planModel, NOW)),
    );

    const together = await loadAllTenantProjections(planModel, NOW);

    expect(together).toHaveLength(3);
    expect(together).toEqual(expect.arrayContaining(alone));
  });

  it("reads the subscriptions once for every workspace", async () => {
    const readsBefore = gate.reads(tenantSubscriptionsTableName);

    await loadAllTenantProjections(GetModel(PlanModel), NOW);

    expect(gate.reads(tenantSubscriptionsTableName) - readsBefore).toBe(1);
  });
});
