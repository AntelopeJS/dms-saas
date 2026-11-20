import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { TenantSubscriptionModel } from "../src/db";
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
