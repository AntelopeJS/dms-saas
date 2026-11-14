import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { Query } from "@antelopejs/interface-data-api/components";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeAll, describe, expect, it } from "vitest";
import { plansDataAPI } from "../src/data-api/platformOwner/plans";
import {
  type Plan,
  PlanModel,
  TenantBillingStateModel,
  tenantBillingStateTableName,
} from "../src/db";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { useQueryGate } from "./helpers/query-gate";
import type { RowFields } from "./helpers/row-fields";

useMongoDatabase();
const gate = useQueryGate();

const controller = new plansDataAPI();
const meta = GetDataControllerMeta(controller);
const PLANS = ["free", "pro"].map((id) =>
  planRow({
    _id: id,
    name: id,
    price: 0,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    isDeleted: false,
  }),
);

async function holdWorkspace(tenantId: string, planId: string): Promise<void> {
  await GetModel(TenantBillingStateModel).insert({
    _id: tenantId,
    tenantId,
    planId,
    billingState: "free",
    isComplimentary: false,
    seats: 1,
    members: 1,
    pendingPlanId: null,
    deletedAt: null,
  });
}

/** Reads the listed fields of every plan row the way a listing does. */
function listRows(plans: RowFields<Plan>[]) {
  return Promise.all(
    plans.map((plan) =>
      Query.ReadProperties(controller, meta, plan, undefined, true),
    ),
  );
}

beforeAll(async () => {
  await GetModel(PlanModel).insert(PLANS);
  await holdWorkspace("tenant-a", "free");
});

describe("the plan catalogue listing", () => {
  it("reads the workspace directory once for every usage column of every row", async () => {
    const readsBefore = gate.reads(tenantBillingStateTableName);

    const rows = await listRows(PLANS);

    expect(rows.map((row) => row.workspaceCount)).toEqual([1, 0]);
    expect(gate.reads(tenantBillingStateTableName) - readsBefore).toBe(1);
  });

  it("counts a workspace that joined after an earlier listing", async () => {
    const before = await listRows(PLANS);
    await holdWorkspace("tenant-b", "pro");

    const after = await listRows(PLANS);

    expect(before.map((row) => row.workspaceCount)).toEqual([1, 0]);
    expect(after.map((row) => row.workspaceCount)).toEqual([1, 1]);
  });
});
