import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanChangePolicy } from "@antelopejs/interface-dms-saas/plan-changes";
import {
  RegisterTenantLifecycleConsumer,
  type TenantLifecycleConsumer,
} from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { workspaceSuspendedSubject } from "../src/notifications/subjects";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import {
  observeTenantLifecycle,
  runTenantLifecycleOperation,
} from "@antelopejs/interface-dms/tenant-lifecycle";
import {
  internal,
  GetTenantPlanConstraints,
  GetPlanChangeActivation,
} from "../src/implementations/dms-saas/plan-changes";
import {
  scheduleGuardedFreeChange,
  cancelGuardedFreeChange,
} from "../src/plan-changes/guarded-free";
import { reconcileGuardedFreeChange } from "../src/plan-changes/guarded-landing";
import {
  isTenantSubscriptionBlocked,
  registerSubscriptionAccessGate,
} from "../src/auth/subscription-access-gate";
import { updateSubscriptionStatus } from "../src/stripe/webhook-shared";
import {
  prepareGuardedPlanChange,
  abortGuardedPreparation,
  admitGuardedProviderEffect,
  confirmGuardedSchedule,
  admitGuardedCancellation,
  confirmGuardedCancellation,
  isGuardedPlanChangeBlocked,
  completeGuardedAbort,
} from "../src/plan-changes/guarded-state";
import { addTenantMember, createUser, implementWithDms } from "./helpers/dms";
import { implementNotificationCore } from "./helpers/notification-core";
import { useLifecycleConsumer } from "./helpers/lifecycle-consumer";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase("guarded-free-downgrade");
const stripe = useSuiteStripe();
const core = implementNotificationCore();
const lifecycle = useLifecycleConsumer("guarded.suite", [
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

async function fixture(prepare = true) {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const deadline = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000);
  await model.insert({
    _id: tenantId,
    planId: "paid",
    stripeSubscriptionId: "stripe-sub",
    status: "active",
    currentPeriodEnd: deadline,
  });
  const read = async () => {
    const subscription = await model.findOne();
    if (!subscription) throw new Error("Missing fixture");
    return subscription;
  };
  if (prepare)
    await prepareGuardedPlanChange(model, await read(), {
      operationId: randomUUID(),
      policyName: "cloud",
      targetPlanId: "free",
      stripeSubscriptionId: "stripe-sub",
      requestedAt: new Date(),
      effectiveAt: deadline,
      phase: "preparing",
      barrierId: randomUUID(),
      incompatibilities: [],
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
  const update = vi
    .spyOn(stripe.write.subscriptions, "update")
    .mockImplementation(async (_id, params) => {
      cancelled = params?.cancel_at_period_end === true;
      return fromPartial({});
    });
  const [targetId] = await GetModel(PlanModel).insert({
    name: "Free",
    price: 0,
    maxMembers: 1,
  });
  const targetPlan = await GetModel(PlanModel).get(targetId);
  if (!targetPlan) throw new Error("Missing plan");
  return {
    model,
    read,
    deadline,
    tenantId,
    ownerId: owner._id,
    targetPlan,
    retrieve,
    update,
  };
}

describe("durable downgrade admission", () => {
  it("publishes future constraints without changing the paid billing plan", async () => {
    const { read, deadline } = await fixture();
    expect(await read()).toMatchObject({
      planId: "paid",
      pendingPlanId: "free",
      pendingPlanChangeAt: deadline,
      guardedPlanChange: { phase: "preparing" },
    });
  });

  it("prevents an aborted preparer from later admitting Stripe", async () => {
    const { model, read } = await fixture();
    const stale = await read();
    await abortGuardedPreparation(model, stale);
    await expect(admitGuardedProviderEffect(model, stale)).rejects.toThrow(
      "revision changed",
    );
    await completeGuardedAbort(model, await read());
    expect(await read()).toMatchObject({
      planId: "paid",
      pendingPlanId: null,
      domainTransition: null,
      guardedPlanChange: null,
    });
  });

  it("allows exactly one competing preparer to admit a provider request", async () => {
    const { model, read } = await fixture();
    const sameRevision = await read();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        admitGuardedProviderEffect(model, sameRevision),
      ),
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await read()).guardedPlanChange?.phase).toBe("provider_pending");
  });

  it("does not release constraints or admit an inverse intent while Stripe is uncertain", async () => {
    const { model, read } = await fixture();
    await admitGuardedProviderEffect(model, await read());
    const uncertain = await read();
    await expect(abortGuardedPreparation(model, uncertain)).rejects.toThrow(
      "preparing",
    );
    await expect(admitGuardedCancellation(model, uncertain)).rejects.toThrow(
      "scheduled",
    );
    expect((await read()).pendingPlanId).toBe("free");
  });

  it("releases future restrictions only after confirmation of the inverse request", async () => {
    const { model, read } = await fixture();
    await admitGuardedProviderEffect(model, await read());
    await confirmGuardedSchedule(model, await read());
    await admitGuardedCancellation(model, await read());
    expect((await read()).pendingPlanId).toBe("free");
    await expect(
      admitGuardedProviderEffect(model, await read()),
    ).rejects.toThrow("preparing");
    await confirmGuardedCancellation(model, await read());
    expect(await read()).toMatchObject({
      planId: "paid",
      pendingPlanId: null,
      guardedPlanChange: null,
    });
  });

  it("closes paid execution exactly at the stored deadline, not on webhook arrival", async () => {
    const { model, read, deadline } = await fixture();
    await admitGuardedProviderEffect(model, await read());
    await confirmGuardedSchedule(model, await read());
    const scheduled = await read();
    expect(
      isGuardedPlanChangeBlocked(scheduled, new Date(deadline.getTime() - 1)),
    ).toBe(false);
    expect(isGuardedPlanChangeBlocked(scheduled, deadline)).toBe(true);
    expect(
      isGuardedPlanChangeBlocked(scheduled, new Date(deadline.getTime() + 1)),
    ).toBe(true);
  });
});

describe("paid-to-Free orchestration with real inventory admission", () => {
  it("cannot emit Stripe after cancellation revokes a stalled validator", async () => {
    const { tenantId, targetPlan, read, update } = await fixture(false);
    let finishValidation!: () => void;
    validate.mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          finishValidation = () => resolve([]);
        }),
    );
    const scheduled = scheduleGuardedFreeChange(tenantId, targetPlan);
    const rejected = expect(scheduled).rejects.toThrow("revision changed");
    await vi.waitFor(() => expect(finishValidation).toBeTypeOf("function"));
    await cancelGuardedFreeChange(tenantId);
    await runTenantLifecycleOperation(tenantId, async () => {
      expect((await GetTenantPlanConstraints(tenantId)).pendingPlan).toBeNull();
    });
    finishValidation();
    await rejected;
    expect(update).not.toHaveBeenCalled();
    expect((await read()).guardedPlanChange).toBeNull();
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
  });

  it("drains a pre-admitted writer before validation and rejects before Stripe mutation", async () => {
    const { tenantId, targetPlan, read, update } = await fixture(false);
    let finishWriter!: () => void;
    let writerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      writerEntered = resolve;
    });
    let inventoryCompatible = true;
    const writer = runTenantLifecycleOperation(tenantId, async () => {
      writerEntered();
      await new Promise<void>((resolve) => {
        finishWriter = resolve;
      });
      inventoryCompatible = false;
    });
    await entered;
    validate.mockImplementation(async () =>
      inventoryCompatible
        ? []
        : [{ code: "volume", message: "Too large for Free" }],
    );
    const scheduled = scheduleGuardedFreeChange(tenantId, targetPlan);
    const rejected = expect(scheduled).rejects.toThrow("incompatible");
    await vi.waitFor(async () =>
      expect((await observeTenantLifecycle(tenantId)).barrierId).not.toBeNull(),
    );
    expect(validate).not.toHaveBeenCalled();
    await expect(
      runTenantLifecycleOperation(tenantId, async () => undefined),
    ).rejects.toThrow();
    finishWriter();
    await writer;
    await rejected;
    expect(update).not.toHaveBeenCalled();
    expect((await read()).pendingPlanId).toBeNull();
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
  });

  it("does not hold inventory closed while Stripe is in flight or invert an ambiguous effect", async () => {
    const { tenantId, targetPlan, read, update } = await fixture(false);
    update.mockImplementation(async () => {
      expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
      await runTenantLifecycleOperation(tenantId, async () => {
        expect(
          (await GetTenantPlanConstraints(tenantId)).pendingPlan?._id,
        ).toBe(targetPlan._id);
      });
      throw new Error("Stripe acknowledgement lost");
    });
    await expect(
      scheduleGuardedFreeChange(tenantId, targetPlan),
    ).rejects.toThrow("acknowledgement lost");
    await expect(cancelGuardedFreeChange(tenantId)).rejects.toThrow(
      "scheduled",
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      "stripe-sub",
      { cancel_at_period_end: true },
      {
        idempotencyKey: expect.stringContaining("free-downgrade:schedule:"),
      },
    );
    expect((await read()).guardedPlanChange?.phase).toBe("provider_pending");
  });

  it("retains paid pricing until the deadline and activates Free without a provider write", async () => {
    const { tenantId, targetPlan, model, read, retrieve, update } =
      await fixture(false);
    await scheduleGuardedFreeChange(tenantId, targetPlan);
    expect((await read()).planId).toBe("paid");
    const scheduled = await read();
    await model.update(scheduled._id, {
      guardedPlanChange: {
        ...scheduled.guardedPlanChange!,
        effectiveAt: new Date(0),
      },
    });
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(true);
    retrieve.mockResolvedValue(fromPartial({ status: "canceled" }));
    update.mockClear();
    lifecycle.mockImplementation(async (message) => {
      expect(message.transition).toBe("reactivation_requested");
      expect(await GetPlanChangeActivation(tenantId)).toEqual({
        planChangeOperationId: message.planChangeOperationId,
        operationId: message.operationId,
        gateId: "dms-saas.plan-change",
      });
      expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(true);
      expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
      const laterGate: tenantAccess.TenantAccessGateInfo = {
        id: "cloud.ban",
        order: 101,
        gate: () => ({ allowed: false, code: "banned" }),
      };
      tenantAccess.RegisterTenantAccessGate(laterGate);
      try {
        expect(
          await tenantAccess.EvaluateTenantAccess(undefined, tenantId),
        ).toEqual([
          {
            gateId: "dms-saas.plan-change",
            code: "saas.errors.workspace.access_blocked",
          },
          { gateId: "cloud.ban", code: "banned" },
        ]);
        expect(
          await tenantAccess.CheckTenantAccess(undefined, tenantId),
        ).toEqual({
          allowed: false,
          code: "saas.errors.workspace.access_blocked",
        });
      } finally {
        tenantAccess.internal.RegisterTenantAccessGate.unregister(laterGate);
      }
      return { receiptId: message.operationId };
    });
    await reconcileGuardedFreeChange(tenantId);
    expect(await read()).toMatchObject({
      planId: targetPlan._id,
      stripeSubscriptionId: null,
      guardedPlanChange: null,
      status: "active",
    });
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(await GetPlanChangeActivation(tenantId)).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(false);
  });

  it("preserves a payment suspension between the activation receipt and final CAS", async () => {
    const { tenantId, targetPlan, model, read, retrieve } =
      await fixture(false);
    await scheduleGuardedFreeChange(tenantId, targetPlan);
    const scheduled = await read();
    await model.update(scheduled._id, {
      guardedPlanChange: {
        ...scheduled.guardedPlanChange!,
        effectiveAt: new Date(0),
      },
    });
    retrieve.mockResolvedValue(fromPartial({ status: "canceled" }));
    lifecycle.mockImplementation(async (message) => {
      expect(await GetPlanChangeActivation(tenantId)).not.toBeNull();
      await updateSubscriptionStatus(tenantId, "suspended");
      expect(await GetPlanChangeActivation(tenantId)).toBeNull();
      expect(
        (await tenantAccess.EvaluateTenantAccess(undefined, tenantId)).map(
          (denial) => denial.gateId,
        ),
      ).toEqual(["dms-saas.subscription-status", "dms-saas.plan-change"]);
      return { receiptId: message.operationId };
    });
    await expect(reconcileGuardedFreeChange(tenantId)).rejects.toThrow(
      "requires reconciliation",
    );
    expect(await read()).toMatchObject({
      status: "suspended",
      guardedPlanChange: { phase: "activating" },
    });
    const late = vi.fn<TenantLifecycleConsumer["consume"]>(async (message) => ({
      receiptId: message.operationId,
    }));
    const registration = RegisterTenantLifecycleConsumer({
      name: "guarded.late",
      transitions: ["reactivation_requested"],
      consume: late,
    });
    try {
      await reconcileGuardedFreeChange(tenantId);
    } finally {
      registration.unregister();
    }
    expect(late).not.toHaveBeenCalled();
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(await read()).toMatchObject({
      status: "suspended",
      guardedPlanChange: null,
    });
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(true);
    expect(await GetPlanChangeActivation(tenantId)).toBeNull();
  });

  it("keeps an incompatible landing outside retention deletion and payment reactivation, then permits remediation", async () => {
    const { tenantId, ownerId, targetPlan, model, read, retrieve } =
      await fixture(false);
    await scheduleGuardedFreeChange(tenantId, targetPlan);
    const scheduled = await read();
    await model.update(scheduled._id, {
      guardedPlanChange: {
        ...scheduled.guardedPlanChange!,
        effectiveAt: new Date(0),
      },
    });
    retrieve.mockResolvedValue(fromPartial({ status: "canceled" }));
    validate.mockResolvedValue([
      { code: "volume", message: "Too large for Free" },
    ]);
    await reconcileGuardedFreeChange(tenantId);
    expect(await read()).toMatchObject({
      planId: "paid",
      status: "active",
      guardedPlanChange: { phase: "blocked" },
    });
    await updateSubscriptionStatus(tenantId, "active");
    await updateSubscriptionStatus(tenantId, "cancelled");
    expect((await read()).status).toBe("active");
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(true);
    expect(
      await model.beginCancelledDeletion(
        scheduled._id,
        new Date(Date.now() + 60_000),
      ),
    ).toBeUndefined();
    expect(core.sendToUsers).toHaveBeenCalledWith(
      [ownerId],
      expect.objectContaining({ subject: workspaceSuspendedSubject }),
      undefined,
      `free-downgrade:blocked:${scheduled.guardedPlanChange?.operationId}`,
      expect.anything(),
    );
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
    validate.mockResolvedValue([]);
    await reconcileGuardedFreeChange(tenantId);
    expect(await read()).toMatchObject({
      planId: targetPlan._id,
      status: "active",
      guardedPlanChange: null,
    });
    expect(lifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ transition: "reactivation_requested" }),
    );
  });
});
