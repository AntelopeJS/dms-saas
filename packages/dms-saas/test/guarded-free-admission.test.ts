import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanChangePolicy } from "@antelopejs/interface-dms-saas/plan-changes";
import { TenantSubscriptionModel } from "../src/db";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { internal } from "../src/implementations/dms-saas/plan-changes";
import { registerSubscriptionAccessGate } from "../src/auth/subscription-access-gate";
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

useMongoDatabase();
useSuiteStripe();
implementNotificationCore();
useLifecycleConsumer("guarded.suite", ["suspended", "reactivation_requested"]);
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

async function fixture() {
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
  return { model, read, deadline };
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
