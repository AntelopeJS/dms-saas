import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { TenantSubscriptionModel } from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { ANY_STRING } from "./helpers/asymmetric-matchers";
import {
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { addTenantMember, createUser } from "./helpers/dms";
import { useLifecycleConsumer } from "./helpers/lifecycle-consumer";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();

const AUTOMATION_OPERATION: unknown = expect.stringMatching(/^automation-/);
const stripe = useSuiteStripe();
implementNotificationCore();
const consume = useLifecycleConsumer("automation-suspension.suite", [
  "suspended",
  "reactivation_requested",
]);
const automation = implementAutomationCatalog();
await registerAutomationNodes();
const suspendWorkspace = registeredAction(automation, "saas.suspend-workspace");

async function workspace(
  status: "active" | "suspended" | "cancelled" = "active",
): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await addTenantMember(tenantId, await createUser(), true);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    status,
    stripeSubscriptionId: `sub_${tenantId}`,
  });
  consume.mockImplementation(async (message) => ({
    receiptId: message.operationId,
  }));
  return tenantId;
}

function stubStripe() {
  return vi
    .spyOn(stripe.write.subscriptions, "update")
    .mockResolvedValue(fromPartial({}));
}

async function statusOf(tenantId: string) {
  return (await GetModel(TenantSubscriptionModel, tenantId).findOne())?.status;
}

describe("saas.suspend-workspace outputs", () => {
  it("reports the status the suspension stored", async () => {
    const tenantId = await workspace();
    stubStripe();

    const output = await suspendWorkspace.execute({ tenantId }, executionCtx());

    expect(await statusOf(tenantId)).toBe("suspended");
    expect(output).toEqual({
      tenantId,
      suspended: true,
      subscriptionStatus: "suspended",
      changed: true,
      operationId: AUTOMATION_OPERATION,
      effectiveAt: ANY_STRING,
    });
  });

  it("reports the status the reactivation stored", async () => {
    const tenantId = await workspace("suspended");
    stubStripe();

    const output = await suspendWorkspace.execute(
      { tenantId, suspended: false },
      executionCtx(),
    );

    expect(await statusOf(tenantId)).toBe("active");
    expect(output).toMatchObject({
      suspended: false,
      subscriptionStatus: "active",
    });
  });

  it("answers a replayed step with the recorded result and calls Stripe once", async () => {
    const tenantId = await workspace();
    const update = stubStripe();
    const ctx = executionCtx();

    const first = await suspendWorkspace.execute({ tenantId }, ctx);
    const replayed = await suspendWorkspace.execute({ tenantId }, ctx);

    expect(replayed).toEqual(first);
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("saas.suspend-workspace in a for-each loop", () => {
  it("suspends every workspace the loop hands the same step", async () => {
    const first = await workspace();
    const second = await workspace();
    stubStripe();
    const ctx = executionCtx();

    const outputs = [
      await suspendWorkspace.execute({ tenantId: first }, ctx),
      await suspendWorkspace.execute({ tenantId: second }, ctx),
    ];

    expect([await statusOf(first), await statusOf(second)]).toEqual([
      "suspended",
      "suspended",
    ]);
    expect(new Set(outputs.map((output) => output?.operationId)).size).toBe(2);
  });
});

async function journalRows(): Promise<number> {
  return (await GetModel(OperatorActionModel).getAll()).length;
}

describe("saas.suspend-workspace test runs", () => {
  it("writes nothing, calls nothing and answers the output shape", async () => {
    const tenantId = await workspace();
    const update = stubStripe();
    consume.mockClear();
    const rowsBefore = await journalRows();

    const output = await suspendWorkspace.dryRun?.(
      { tenantId },
      executionCtx({ dryRun: true }),
    );

    expect(output).toEqual({
      tenantId,
      suspended: true,
      subscriptionStatus: "suspended",
      changed: true,
      operationId: AUTOMATION_OPERATION,
      effectiveAt: null,
    });
    expect(await statusOf(tenantId)).toBe("active");
    expect(await journalRows()).toBe(rowsBefore);
    expect(update).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("refuses a cancelled workspace", async () => {
    const tenantId = await workspace("cancelled");

    await expect(
      suspendWorkspace.dryRun?.({ tenantId }, executionCtx({ dryRun: true })),
    ).rejects.toThrow("saas.errors.workspace.is_cancelled");
  });

  it("refuses an unknown workspace", async () => {
    await expect(
      suspendWorkspace.dryRun?.(
        { tenantId: "no-such-workspace" },
        executionCtx({ dryRun: true }),
      ),
    ).rejects.toThrow('unknown workspace "no-such-workspace"');
  });

  it("refuses an empty workspace id", async () => {
    await expect(
      suspendWorkspace.execute({ tenantId: "  " }, executionCtx()),
    ).rejects.toThrow("saas.suspend-workspace: tenantId");
  });
});

describe("saas.suspend-workspace on a workspace already in the requested state", () => {
  it("succeeds without a journal row", async () => {
    const tenantId = await workspace("suspended");
    const update = stubStripe();
    const rowsBefore = await journalRows();

    const output = await suspendWorkspace.execute({ tenantId }, executionCtx());

    expect(output).toMatchObject({
      suspended: true,
      subscriptionStatus: "suspended",
      changed: false,
      effectiveAt: null,
    });
    expect(await journalRows()).toBe(rowsBefore);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves another workspace as it is", async () => {
    const target = await workspace();
    const other = await workspace();
    stubStripe();

    await suspendWorkspace.execute({ tenantId: target }, executionCtx());

    expect(await statusOf(other)).toBe("active");
  });
});
