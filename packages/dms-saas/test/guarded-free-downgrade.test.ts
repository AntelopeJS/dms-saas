import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
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

const effects = vi.hoisted(() => ({
  retrieve: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  lifecycle: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: effects.retrieve, update: effects.update },
  }),
}));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/operator-actions/lifecycle-outbox", () => ({
  dispatchWorkspaceLifecycle: effects.lifecycle,
}));
vi.mock("../src/notifications", () => ({
  notifyTenantOwners: effects.notify,
  workspaceSuspendedSubject: {},
}));

beforeEach(() => {
  vi.resetAllMocks();
  effects.validate.mockResolvedValue([]);
  internal.RegisterPlanChangePolicy.register("cloud", {
    name: "cloud",
    validatePlanChange: effects.validate,
  });
});
let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongo.getUri(), database: "guarded-free-downgrade" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
  const require = createRequire(import.meta.url);
  const dmsRoot = dirname(require.resolve("@antelopejs/dms/package.json"));
  ImplementInterface(
    tenantAccess,
    require(join(dmsRoot, "dist/implementations/dms/tenant-access.js")),
  );
  registerSubscriptionAccessGate();
}, 60_000);
afterAll(async () => {
  await destroy();
  await mongo?.stop();
});

async function fixture(prepare = true) {
  const tenantId = randomUUID();
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
  effects.retrieve.mockImplementation(async () => ({
    status: "active",
    cancel_at_period_end: cancelled,
    items: { data: [{ current_period_end: deadline.getTime() / 1000 }] },
  }));
  effects.update.mockImplementation(async (_id, params) => {
    cancelled = params.cancel_at_period_end;
    return {};
  });
  const [targetId] = await GetModel(PlanModel).insert({
    name: "Free",
    price: 0,
    maxMembers: 1,
  });
  const targetPlan = await GetModel(PlanModel).get(targetId);
  if (!targetPlan) throw new Error("Missing plan");
  return { model, read, deadline, tenantId, targetPlan };
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
    const { tenantId, targetPlan, read } = await fixture(false);
    let finishValidation!: () => void;
    effects.validate.mockImplementation(
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
    expect(effects.update).not.toHaveBeenCalled();
    expect((await read()).guardedPlanChange).toBeNull();
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
  });

  it("drains a pre-admitted writer before validation and rejects before Stripe mutation", async () => {
    const { tenantId, targetPlan, read } = await fixture(false);
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
    effects.validate.mockImplementation(async () =>
      inventoryCompatible
        ? []
        : [{ code: "volume", message: "Too large for Free" }],
    );
    const scheduled = scheduleGuardedFreeChange(tenantId, targetPlan);
    const rejected = expect(scheduled).rejects.toThrow("incompatible");
    await vi.waitFor(async () =>
      expect((await observeTenantLifecycle(tenantId)).barrierId).not.toBeNull(),
    );
    expect(effects.validate).not.toHaveBeenCalled();
    await expect(
      runTenantLifecycleOperation(tenantId, async () => undefined),
    ).rejects.toThrow();
    finishWriter();
    await writer;
    await rejected;
    expect(effects.update).not.toHaveBeenCalled();
    expect((await read()).pendingPlanId).toBeNull();
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
  });

  it("does not hold inventory closed while Stripe is in flight or invert an ambiguous effect", async () => {
    const { tenantId, targetPlan, read } = await fixture(false);
    effects.update.mockImplementation(async () => {
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
    expect(effects.update).toHaveBeenCalledTimes(1);
    expect((await read()).guardedPlanChange?.phase).toBe("provider_pending");
  });

  it("retains paid pricing until the deadline and activates Free without a provider write", async () => {
    const { tenantId, targetPlan, model, read } = await fixture(false);
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
    effects.retrieve.mockResolvedValue({ status: "canceled" });
    effects.update.mockClear();
    effects.lifecycle.mockImplementation(async (message) => {
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
    });
    await reconcileGuardedFreeChange(tenantId);
    expect(await read()).toMatchObject({
      planId: targetPlan._id,
      stripeSubscriptionId: null,
      guardedPlanChange: null,
      status: "active",
    });
    expect(effects.lifecycle).toHaveBeenCalledTimes(1);
    expect(await GetPlanChangeActivation(tenantId)).toBeNull();
    expect(effects.update).not.toHaveBeenCalled();
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(false);
  });

  it("preserves a payment suspension between the activation receipt and final CAS", async () => {
    const { tenantId, targetPlan, model, read } = await fixture(false);
    await scheduleGuardedFreeChange(tenantId, targetPlan);
    const scheduled = await read();
    await model.update(scheduled._id, {
      guardedPlanChange: {
        ...scheduled.guardedPlanChange!,
        effectiveAt: new Date(0),
      },
    });
    effects.retrieve.mockResolvedValue({ status: "canceled" });
    effects.lifecycle.mockImplementation(async () => {
      expect(await GetPlanChangeActivation(tenantId)).not.toBeNull();
      await updateSubscriptionStatus(tenantId, "suspended");
      expect(await GetPlanChangeActivation(tenantId)).toBeNull();
      expect(
        (await tenantAccess.EvaluateTenantAccess(undefined, tenantId)).map(
          (denial) => denial.gateId,
        ),
      ).toEqual(["dms-saas.subscription-status", "dms-saas.plan-change"]);
    });
    await expect(reconcileGuardedFreeChange(tenantId)).rejects.toThrow(
      "requires reconciliation",
    );
    expect(await read()).toMatchObject({
      status: "suspended",
      guardedPlanChange: { phase: "activating" },
    });
    await reconcileGuardedFreeChange(tenantId);
    expect(effects.lifecycle).toHaveBeenCalledTimes(1);
    expect(await read()).toMatchObject({
      status: "suspended",
      guardedPlanChange: null,
    });
    expect((await isTenantSubscriptionBlocked(tenantId)).blocked).toBe(true);
    expect(await GetPlanChangeActivation(tenantId)).toBeNull();
  });

  it("keeps an incompatible landing outside retention deletion and payment reactivation, then permits remediation", async () => {
    const { tenantId, targetPlan, model, read } = await fixture(false);
    await scheduleGuardedFreeChange(tenantId, targetPlan);
    const scheduled = await read();
    await model.update(scheduled._id, {
      guardedPlanChange: {
        ...scheduled.guardedPlanChange!,
        effectiveAt: new Date(0),
      },
    });
    effects.retrieve.mockResolvedValue({ status: "canceled" });
    effects.validate.mockResolvedValue([
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
    expect(effects.notify).toHaveBeenCalled();
    expect((await observeTenantLifecycle(tenantId)).barrierId).toBeNull();
    effects.validate.mockResolvedValue([]);
    await reconcileGuardedFreeChange(tenantId);
    expect(await read()).toMatchObject({
      planId: targetPlan._id,
      status: "active",
      guardedPlanChange: null,
    });
    expect(effects.lifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ transition: "reactivation_requested" }),
    );
  });
});
