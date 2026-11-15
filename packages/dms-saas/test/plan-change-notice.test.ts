import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlanChangeIncompatibility,
  PlanChangeNotice,
  PlanChangePolicy,
} from "@antelopejs/interface-dms-saas/plan-changes";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { internal } from "../src/implementations/dms-saas/plan-changes";
import {
  PlanChangeIncompatibleError,
  previewGuardedFreeChange,
  scheduleGuardedFreeChange,
} from "../src/plan-changes/guarded-free";
import { registerSubscriptionAccessGate } from "../src/auth/subscription-access-gate";
import { addTenantMember, createUser, implementWithDms } from "./helpers/dms";
import { implementNotificationCore } from "./helpers/notification-core";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
const stripe = useSuiteStripe();
implementNotificationCore();
implementWithDms(tenantAccess, "implementations/dms/tenant-access.js");
registerSubscriptionAccessGate();

const validate = vi.fn<PlanChangePolicy["validatePlanChange"]>();

const RESTART: PlanChangeNotice = {
  severity: "notice",
  code: "databases_restart",
  message: "2 databases will restart",
  resource: "databases",
};
const TOO_LARGE: PlanChangeIncompatibility = {
  code: "volume",
  message: "Too large for Free",
};

beforeEach(() => {
  validate.mockReset();
  internal.RegisterPlanChangePolicy.register("cloud", {
    name: "cloud",
    validatePlanChange: validate,
  });
});

async function fixture() {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  const deadline = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    stripeSubscriptionId: "stripe-sub",
    status: "active",
    currentPeriodEnd: deadline,
  });
  let cancelled = false;
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockImplementation(
    async () =>
      fromPartial({
        status: "active",
        cancel_at_period_end: cancelled,
        items: { data: [{ current_period_end: deadline.getTime() / 1000 }] },
      }),
  );
  const update = vi
    .spyOn(stripe.write.subscriptions, "update")
    .mockImplementation(async (_id, params) => {
      cancelled = params?.cancel_at_period_end === true;
      return fromPartial({});
    });
  const [targetId] = await GetModel(PlanModel).insert({
    name: "Free",
    price: 0,
    maxMembers: 10,
  });
  const targetPlan = await GetModel(PlanModel).get(targetId);
  if (!targetPlan) throw new Error("Missing plan");
  return { tenantId, deadline, targetPlan, update };
}

describe("a plan-change policy notice", () => {
  it("is returned by the preview and does not stop the change from being scheduled", async () => {
    const { tenantId, deadline, targetPlan, update } = await fixture();
    validate.mockResolvedValue([RESTART]);

    await expect(
      previewGuardedFreeChange(tenantId, targetPlan),
    ).resolves.toEqual([RESTART]);
    await expect(
      scheduleGuardedFreeChange(tenantId, targetPlan),
    ).resolves.toEqual(deadline);

    expect(update).toHaveBeenCalledWith(
      "stripe-sub",
      { cancel_at_period_end: true },
      expect.anything(),
    );
  });

  it("is kept out of the refusal when a blocking entry comes with it", async () => {
    const { tenantId, targetPlan, update } = await fixture();
    validate.mockResolvedValue([RESTART, TOO_LARGE]);

    const refusal = await previewGuardedFreeChange(tenantId, targetPlan).catch(
      (error: unknown) => error,
    );
    const scheduling = await scheduleGuardedFreeChange(
      tenantId,
      targetPlan,
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(PlanChangeIncompatibleError);
    expect(
      refusal instanceof PlanChangeIncompatibleError &&
        refusal.incompatibilities,
    ).toEqual([TOO_LARGE]);
    expect(
      scheduling instanceof PlanChangeIncompatibleError &&
        scheduling.incompatibilities,
    ).toEqual([TOO_LARGE]);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an entry whose severity is not recognised", async () => {
    const { tenantId, targetPlan } = await fixture();
    const unknown = fromAny<PlanChangeIncompatibility, unknown>({
      severity: "advisory",
      code: "future_severity",
      message: "Written for a newer interface",
    });
    validate.mockResolvedValue([unknown]);

    const refusal = await previewGuardedFreeChange(tenantId, targetPlan).catch(
      (error: unknown) => error,
    );

    expect(
      refusal instanceof PlanChangeIncompatibleError &&
        refusal.incompatibilities,
    ).toEqual([unknown]);
  });
});
