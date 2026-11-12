import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { TenantLifecycleModel } from "@antelopejs/interface-dms/db/internal/tenantLifecycle.model";
import {
  observeTenantLifecycle,
  runTenantLifecycleOperation,
} from "@antelopejs/interface-dms/tenant-lifecycle";
import type { PlanChangePolicy } from "@antelopejs/interface-dms-saas/plan-changes";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { internal } from "../src/implementations/dms-saas/plan-changes";
import {
  cancelGuardedFreeChange,
  scheduleGuardedFreeChange,
} from "../src/plan-changes/guarded-free";
import { reconcileGuardedFreeChange } from "../src/plan-changes/guarded-landing";
import { implementWithDms } from "./helpers/dms";
import { latch } from "./helpers/latch";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
const stripe = useSuiteStripe();
implementWithDms(tenantAccess, "implementations/dms/tenant-access.js");

const validate = vi.fn<PlanChangePolicy["validatePlanChange"]>();
const incompatible = [{ code: "volume", message: "Too large for Free" }];

beforeEach(() => {
  validate.mockReset();
  internal.RegisterPlanChangePolicy.register("cloud", {
    name: "cloud",
    validatePlanChange: validate,
  });
});

async function paidWorkspace() {
  const tenantId = randomUUID();
  const periodEnd = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    stripeSubscriptionId: "stripe-sub",
    status: "active",
    currentPeriodEnd: periodEnd,
  });
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockImplementation(
    async () =>
      fromPartial({
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: periodEnd.getTime() / 1000 }] },
      }),
  );
  const [planId] = await GetModel(PlanModel).insert({
    name: "Free",
    price: 0,
    maxMembers: 1,
  });
  const free = await GetModel(PlanModel).get(planId);
  if (!free) throw new Error("Missing plan");
  return { tenantId, free };
}

describe("a stale guarded-change cancellation", () => {
  it("leaves the abort of a later operation to the cron, which releases its barrier", async () => {
    const { tenantId, free } = await paidWorkspace();
    const firstValidation = latch();
    validate.mockImplementationOnce(async () => {
      await firstValidation.promise;
      return incompatible;
    });
    const first = scheduleGuardedFreeChange(tenantId, free);
    const firstRejected = expect(first).rejects.toThrow("incompatible");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledOnce());

    const cancellerReleased = latch();
    const cancellerHeld = latch();
    const lifecycle: { resume: TenantLifecycleModel["resume"] } =
      TenantLifecycleModel.prototype;
    const realResume = lifecycle.resume;
    const resume = vi
      .spyOn(TenantLifecycleModel.prototype, "resume")
      .mockImplementationOnce(async function (
        this: TenantLifecycleModel,
        ...args
      ) {
        const resumed = await realResume.apply(this, args);
        cancellerReleased.resolve();
        await cancellerHeld.promise;
        return resumed;
      })
      .mockImplementationOnce(realResume)
      .mockRejectedValueOnce(new Error("connection reset"));
    onTestFinished(() => resume.mockRestore());
    const canceller = cancelGuardedFreeChange(tenantId);
    await cancellerReleased.promise;

    firstValidation.resolve();
    await firstRejected;
    validate.mockResolvedValueOnce(incompatible);
    await expect(scheduleGuardedFreeChange(tenantId, free)).rejects.toThrow(
      "connection reset",
    );
    expect((await observeTenantLifecycle(tenantId)).barrierId).not.toBeNull();

    cancellerHeld.resolve();
    await canceller;

    await expect(reconcileGuardedFreeChange(tenantId)).resolves.toBe(true);
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
    await expect(
      runTenantLifecycleOperation(tenantId, async () => "ok"),
    ).resolves.toBe("ok");
  });
});
