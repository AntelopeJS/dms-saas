import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, describe, expect, it } from "vitest";
import {
  TenantBillingStateModel,
  tenantBillingStateTableName,
} from "../src/db";
import { loadDirectoryRows } from "../src/metrics/directory-summary";
import { SaasDashboardController } from "../src/routes/platformOwner/dashboard";
import { useMongoDatabase } from "./helpers/mongo";
import { useQueryGate } from "./helpers/query-gate";

useMongoDatabase();
const gate = useQueryGate();

const OWNER = fromPartial<User>({ _id: "operator" });

async function publishWorkspace(tenantId: string): Promise<void> {
  await GetModel(TenantBillingStateModel).insert({
    _id: tenantId,
    tenantId,
    planId: "free",
    billingState: "free",
    isComplimentary: false,
    seats: 1,
    members: 1,
    mrrMinor: 0,
    currency: "EUR",
    deletedAt: null,
  });
}

beforeAll(async () => {
  await publishWorkspace("tenant-a");
});

describe("the dashboard's directory reads", () => {
  it("reads the directory once for the cards a page load asks for at once", async () => {
    const controller = new SaasDashboardController();
    const readsBefore = gate.reads(tenantBillingStateTableName);

    await Promise.all([
      controller.headline(OWNER),
      controller.workspacesByStatus(OWNER),
      controller.plansByMrr(OWNER),
    ]);

    expect(gate.reads(tenantBillingStateTableName) - readsBefore).toBe(1);
  });

  it("sees a workspace published after an earlier read", async () => {
    const before = await loadDirectoryRows();
    await publishWorkspace("tenant-b");

    const after = await loadDirectoryRows();

    expect(before.map((row) => row.tenantId)).toEqual(["tenant-a"]);
    expect(after.map((row) => row.tenantId).sort()).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });
});
