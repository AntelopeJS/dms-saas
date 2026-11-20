import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { automationLoopGuard } from "../src/automation/loop-guard";
import { runAsAutomation } from "../src/automation/origin";
import { recomputeTenantBillingState } from "../src/billing-state";
import { type TenantSubscription, TenantSubscriptionModel } from "../src/db";
import {
  armTrigger,
  deliveryIds,
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { addTenantMember, createUser } from "./helpers/dms";
import { useLifecycleConsumer } from "./helpers/lifecycle-consumer";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";
import { insertPlan } from "./helpers/plans";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
const stripe = useSuiteStripe();
implementNotificationCore();
const consume = useLifecycleConsumer("automation-billing.suite", [
  "suspended",
  "reactivation_requested",
]);
const automation = implementAutomationCatalog();
await registerAutomationNodes();

const SMALL_PLAN = "small-plan";
const LARGE_PLAN = "large-plan";

beforeAll(async () => {
  await insertPlan({ _id: SMALL_PLAN, price: 10 });
  await insertPlan({ _id: LARGE_PLAN, price: 50 });
});

beforeEach(() => {
  automationLoopGuard.reset();
});

/** A workspace billed on Stripe, its billing state already published once. */
async function publishedWorkspace(
  fields: Partial<TenantSubscription> = {},
): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await addTenantMember(tenantId, await createUser(), true);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: SMALL_PLAN,
    status: "active",
    stripeSubscriptionId: `sub_${tenantId}`,
    ...fields,
  });
  await recomputeTenantBillingState(tenantId);
  return tenantId;
}

async function updateSubscription(
  tenantId: string,
  patch: Partial<TenantSubscription>,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).update(tenantId, patch);
}

describe("saas.billing-state-changed", () => {
  it("fires once when a workspace goes past due", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.billing-state-changed");

    await updateSubscription(tenantId, { status: "past_due" });
    await recomputeTenantBillingState(tenantId);
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId,
        fromState: "active",
        toState: "past_due",
        planId: SMALL_PLAN,
      }),
    ]);
    expect(deliveryIds(payloads)[0]).toMatch(
      new RegExp(`^billing-state:${tenantId}:`),
    );
  });

  it("does not fire on the first publication of a workspace", async () => {
    const payloads = await armTrigger(automation, "saas.billing-state-changed");

    await publishedWorkspace();

    expect(payloads).toEqual([]);
  });

  it("fires once for two recomputations racing on the same change", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.billing-state-changed");
    await updateSubscription(tenantId, { status: "past_due" });

    await Promise.all([
      recomputeTenantBillingState(tenantId),
      recomputeTenantBillingState(tenantId),
      recomputeTenantBillingState(tenantId),
    ]);

    expect(payloads).toHaveLength(1);
  });

  it("fires only for transitions into the configured state", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(
      automation,
      "saas.billing-state-changed",
      {
        toState: "suspended",
      },
    );

    await updateSubscription(tenantId, { status: "past_due" });
    await recomputeTenantBillingState(tenantId);
    await updateSubscription(tenantId, { status: "suspended" });
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({ fromState: "past_due", toState: "suspended" }),
    ]);
  });

  it("hands each workspace its own transition", async () => {
    const changed = await publishedWorkspace();
    const untouched = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.billing-state-changed");

    await updateSubscription(changed, { status: "past_due" });
    await recomputeTenantBillingState(changed);
    await recomputeTenantBillingState(untouched);

    expect(payloads).toEqual([expect.objectContaining({ tenantId: changed })]);
  });
});

describe("saas.billing-state-changed and procedure writes", () => {
  const suspendWorkspace = registeredAction(
    automation,
    "saas.suspend-workspace",
  );

  async function suspendThroughProcedure(tenantId: string): Promise<void> {
    vi.spyOn(stripe.write.subscriptions, "update").mockResolvedValue(
      fromPartial({}),
    );
    consume.mockImplementation(async (message) => ({
      receiptId: message.operationId,
    }));
    await suspendWorkspace.execute(
      { tenantId },
      executionCtx({ procedureId: "procedure-suspends" }),
    );
  }

  it("ignores a suspension a procedure made", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.billing-state-changed");

    await suspendThroughProcedure(tenantId);

    expect(payloads).toEqual([]);
  });

  it("fires for it with includeAutomationWrites, naming the procedure", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(
      automation,
      "saas.billing-state-changed",
      {
        includeAutomationWrites: true,
      },
    );

    await suspendThroughProcedure(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId,
        toState: "suspended",
        originProcedureId: "procedure-suspends",
      }),
    ]);
  });

  it("stops a workspace's procedure-made transitions past the loop guard's limit", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(
      automation,
      "saas.billing-state-changed",
      {
        includeAutomationWrites: true,
      },
    );

    for (let flip = 0; flip < 8; flip += 1) {
      await updateSubscription(tenantId, {
        status: flip % 2 === 0 ? "past_due" : "active",
      });
      await runAsAutomation(
        { procedureId: "looping", runId: `run-${flip}` },
        () => recomputeTenantBillingState(tenantId),
      );
    }

    expect(payloads).toHaveLength(5);
  });
});

describe("saas.plan-changed", () => {
  it("fires an upgrade when a workspace moves to a dearer plan", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.plan-changed");

    await updateSubscription(tenantId, { planId: LARGE_PLAN });
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId,
        fromPlanId: SMALL_PLAN,
        toPlanId: LARGE_PLAN,
        direction: "upgrade",
        billingState: "active",
      }),
    ]);
    expect(deliveryIds(payloads)[0]).toMatch(new RegExp(`^plan:${tenantId}:`));
  });

  it("fires a downgrade when a cheaper plan lands", async () => {
    const tenantId = await publishedWorkspace({ planId: LARGE_PLAN });
    const payloads = await armTrigger(automation, "saas.plan-changed");

    await updateSubscription(tenantId, { planId: SMALL_PLAN });
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({ direction: "downgrade" }),
    ]);
  });

  it("does not fire for a scheduled change that has not landed", async () => {
    const tenantId = await publishedWorkspace({ planId: LARGE_PLAN });
    const payloads = await armTrigger(automation, "saas.plan-changed");

    await updateSubscription(tenantId, { pendingPlanId: SMALL_PLAN });
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([]);
  });

  it("fires only in the configured direction", async () => {
    const tenantId = await publishedWorkspace();
    const payloads = await armTrigger(automation, "saas.plan-changed", {
      direction: "downgrade",
    });

    await updateSubscription(tenantId, { planId: LARGE_PLAN });
    await recomputeTenantBillingState(tenantId);
    await updateSubscription(tenantId, { planId: SMALL_PLAN });
    await recomputeTenantBillingState(tenantId);

    expect(payloads).toEqual([
      expect.objectContaining({
        fromPlanId: LARGE_PLAN,
        direction: "downgrade",
      }),
    ]);
  });
});
