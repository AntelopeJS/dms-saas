import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import {
  observeTenantLifecycle,
  runTenantLifecycleOperation,
} from "@antelopejs/interface-dms/tenant-lifecycle";
import type { PlanChangePolicy } from "@antelopejs/interface-dms-saas/plan-changes";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSubscriptionAccessGate } from "../src/auth/subscription-access-gate";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { internal } from "../src/implementations/dms-saas/plan-changes";
import { scheduleGuardedFreeChange } from "../src/plan-changes/guarded-free";
import { reconcileGuardedFreeChange } from "../src/plan-changes/guarded-landing";
import { addTenantMember, createUser, implementWithDms } from "./helpers/dms";
import { latch } from "./helpers/latch";
import { useLifecycleConsumer } from "./helpers/lifecycle-consumer";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";
import { TenantLifecycleModel } from "../node_modules/@antelopejs/interface-dms/dist/db/internal/tenantLifecycle.model.js";

useMongoDatabase();
const stripe = useSuiteStripe();
implementNotificationCore();
useLifecycleConsumer("guarded.concurrency", [
  "suspended",
  "reactivation_requested",
]);
implementWithDms(tenantAccess, "implementations/dms/tenant-access.js");
registerSubscriptionAccessGate();

const validate = vi.fn<PlanChangePolicy["validatePlanChange"]>();

beforeEach(() => {
  validate.mockReset();
  validate.mockResolvedValue([]);
  internal.RegisterPlanChangePolicy.register("cloud", {
    name: "cloud",
    validatePlanChange: validate,
  });
});

async function dueFreeChange() {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await addTenantMember(tenantId, await createUser(), true);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const deadline = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000);
  await model.insert({
    _id: tenantId,
    planId: "paid",
    stripeSubscriptionId: "stripe-sub",
    status: "active",
    currentPeriodEnd: deadline,
  });
  let cancelled = false;
  const retrieve = vi
    .spyOn(stripe.write.subscriptions, "retrieve")
    .mockImplementation(async () =>
      fromPartial({
        status: "active",
        cancel_at_period_end: cancelled,
        items: { data: [{ current_period_end: deadline.getTime() / 1000 }] },
      }),
    );
  vi.spyOn(stripe.write.subscriptions, "update").mockImplementation(
    async (_id, params) => {
      cancelled = params?.cancel_at_period_end === true;
      return fromPartial({});
    },
  );
  const [targetId] = await GetModel(PlanModel).insert({
    name: "Free",
    price: 0,
    maxMembers: 1,
  });
  const targetPlan = await GetModel(PlanModel).get(targetId);
  if (!targetPlan) throw new Error("Missing plan");
  await scheduleGuardedFreeChange(tenantId, targetPlan);
  const scheduled = await model.findOne();
  if (!scheduled?.guardedPlanChange) throw new Error("Missing schedule");
  await model.update(scheduled._id, {
    guardedPlanChange: {
      ...scheduled.guardedPlanChange,
      effectiveAt: new Date(0),
    },
  });
  retrieve.mockResolvedValue(fromPartial({ status: "canceled" }));
  return { tenantId, model, targetPlan };
}

describe("concurrent guarded Free landings", () => {
  it("leaves another landing's activation and its barrier to the reconciliation that releases it", async () => {
    const { tenantId, model, targetPlan } = await dueFreeChange();
    const firstReleased = latch();
    const firstHeld = latch();
    const release = TenantLifecycleModel.prototype.resume;
    const resume = vi.spyOn(TenantLifecycleModel.prototype, "resume");
    validate.mockImplementationOnce(async () => {
      resume.mockImplementationOnce(async function (
        this: TenantLifecycleModel,
        ...args
      ) {
        const released = await release.apply(this, args);
        firstReleased.resolve();
        await firstHeld.promise;
        return released;
      });
      return [{ code: "volume", message: "Too large for Free" }];
    });
    const first = reconcileGuardedFreeChange(tenantId);
    await firstReleased.promise;
    expect((await model.findOne())?.guardedPlanChange?.phase).toBe("blocked");

    validate.mockImplementationOnce(async () => {
      resume.mockRejectedValueOnce(new Error("connection reset on resume"));
      return [];
    });
    await expect(reconcileGuardedFreeChange(tenantId)).rejects.toThrow(
      "connection reset on resume",
    );
    expect((await model.findOne())?.guardedPlanChange?.phase).toBe(
      "activating",
    );

    firstHeld.resolve();
    await expect(first).resolves.toBe(true);
    await reconcileGuardedFreeChange(tenantId);

    expect(await model.findOne()).toMatchObject({
      planId: targetPlan._id,
      guardedPlanChange: null,
    });
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
    await expect(
      runTenantLifecycleOperation(tenantId, async () => "written"),
    ).resolves.toBe("written");
  });
});
