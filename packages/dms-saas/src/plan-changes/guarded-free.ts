import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { PlanChangeIncompatibility } from "@antelopejs/interface-dms-saas/plan-changes";
import {
  type GuardedPlanChange,
  type Plan,
  type TenantSubscription,
  TenantSubscriptionModel,
  PlanModel,
} from "../db";
import {
  getPlanChangePolicy,
  validateGuardedPlanChange,
} from "../implementations/dms-saas/plan-changes";
import { getStripeClient } from "../stripe/client";
import { readSubscriptionPeriodEnd } from "../stripe/payload-shapes";
import {
  abortGuardedPreparation,
  admitGuardedCancellation,
  admitGuardedProviderEffect,
  completeGuardedAbort,
  confirmGuardedCancellation,
  confirmGuardedSchedule,
  prepareGuardedPlanChange,
} from "./guarded-state";
import { drainPlanInventory, releasePlanInventory } from "./inventory-barrier";

/** Structured rejection shared by previews and scheduling. */
export class PlanChangeIncompatibleError extends Error {
  constructor(readonly incompatibilities: PlanChangeIncompatibility[]) {
    super("The workspace is incompatible with the target plan");
  }
}

async function readSubscription(tenantId: string): Promise<TenantSubscription> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription) throw new Error("Workspace subscription is missing");
  return subscription;
}

/** Preview is advisory; admission and schedule validation are always repeated. */
export async function previewGuardedFreeChange(
  tenantId: string,
  targetPlan: Plan,
): Promise<void> {
  const current = await readSubscription(tenantId);
  const issues = await validateGuardedPlanChange({
    tenantId,
    currentPlan: current.planId
      ? ((await GetModel(PlanModel).get(current.planId)) ?? null)
      : null,
    targetPlan,
    operationId: randomUUID(),
    phase: "preview",
    effectiveAt: current.currentPeriodEnd ?? null,
  });
  if (issues.length) throw new PlanChangeIncompatibleError(issues);
}

/** Publish a target only after reading the exact subscription being cancelled. */
async function prepareFreeChange(
  tenantId: string,
  targetPlan: Plan,
): Promise<GuardedPlanChange> {
  if (targetPlan.price !== 0 || targetPlan.paymentProviderRefs?.stripePriceId) {
    throw new Error("Guarded paid-to-paid downgrades are not supported");
  }
  const policy = getPlanChangePolicy();
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const current = await readSubscription(tenantId);
  if (!current.stripeSubscriptionId || current.status !== "active") {
    throw new Error("A paid active subscription is required");
  }
  const stripe = getStripeClient();
  const live = await stripe.subscriptions.retrieve(
    current.stripeSubscriptionId,
  );
  const effectiveAt = readSubscriptionPeriodEnd(live);
  if (
    !effectiveAt ||
    effectiveAt.getTime() <= Date.now() ||
    live.status !== "active" ||
    live.schedule ||
    live.cancel_at_period_end
  ) {
    throw new Error(
      "Existing provider state requires reconciliation before scheduling",
    );
  }
  const change: GuardedPlanChange = {
    operationId: randomUUID(),
    policyName: policy.name,
    targetPlanId: targetPlan._id,
    stripeSubscriptionId: current.stripeSubscriptionId,
    effectiveAt,
    requestedAt: new Date(),
    barrierId: randomUUID(),
    phase: "preparing",
    incompatibilities: [],
  };
  await prepareGuardedPlanChange(model, current, change);
  return change;
}

/**
 * Use the existing end-of-period cancellation, never a future paid price.
 * Only this emitter can acknowledge provider_pending. Recovery never infers
 * that a request settled from a GET, timeout or expired idempotency key.
 * The provider effect is admitted with the revision read under the barrier,
 * never a fresh revision that could belong to an aborted or replaced
 * preparation.
 */
export async function scheduleGuardedFreeChange(
  tenantId: string,
  targetPlan: Plan,
): Promise<Date> {
  const change = await prepareFreeChange(tenantId, targetPlan);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const effectiveAt = change.effectiveAt;
  try {
    const drained = await drainPlanInventory(tenantId, model, change);
    const issues = await validateGuardedPlanChange(
      {
        tenantId,
        currentPlan: drained.planId
          ? ((await GetModel(PlanModel).get(drained.planId)) ?? null)
          : null,
        targetPlan,
        operationId: change.operationId,
        phase: "schedule",
        effectiveAt,
      },
      change.policyName,
    );
    if (issues.length) throw new PlanChangeIncompatibleError(issues);
    await admitGuardedProviderEffect(model, drained);
  } catch (error) {
    const latest = await readSubscription(tenantId);
    if (
      latest.guardedPlanChange?.operationId === change.operationId &&
      latest.guardedPlanChange.phase === "preparing"
    ) {
      await abortGuardedPreparation(model, latest);
    }
    await releasePlanInventory(tenantId, change);
    const aborted = await readSubscription(tenantId);
    if (
      aborted.guardedPlanChange?.operationId === change.operationId &&
      aborted.guardedPlanChange.phase === "aborting"
    ) {
      await completeGuardedAbort(model, aborted);
    }
    throw error;
  }
  await releasePlanInventory(tenantId, change);
  const stripe = getStripeClient();
  await stripe.subscriptions.update(
    change.stripeSubscriptionId,
    { cancel_at_period_end: true },
    {
      idempotencyKey: `free-downgrade:schedule:${change.operationId}`,
    },
  );
  const confirmed = await stripe.subscriptions.retrieve(
    change.stripeSubscriptionId,
  );
  if (
    !confirmed.cancel_at_period_end ||
    confirmed.schedule ||
    readSubscriptionPeriodEnd(confirmed)?.getTime() !== effectiveAt.getTime()
  ) {
    throw new Error("Downgrade provider confirmation requires reconciliation");
  }
  await confirmGuardedSchedule(model, await readSubscription(tenantId));
  return effectiveAt;
}

/** Inversion is a separate durable step; uncertainty retains target restrictions. */
export async function cancelGuardedFreeChange(tenantId: string): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const current = await readSubscription(tenantId);
  const change = current.guardedPlanChange;
  if (!change) return;
  if (change.phase === "preparing" || change.phase === "aborting") {
    if (change.phase === "preparing")
      await abortGuardedPreparation(model, current);
    await releasePlanInventory(tenantId, change);
    await completeGuardedAbort(model, await readSubscription(tenantId));
    return;
  }
  await admitGuardedCancellation(model, current);
  const stripe = getStripeClient();
  await stripe.subscriptions.update(
    change.stripeSubscriptionId,
    { cancel_at_period_end: false },
    {
      idempotencyKey: `free-downgrade:cancel:${change.operationId}`,
    },
  );
  const confirmed = await stripe.subscriptions.retrieve(
    change.stripeSubscriptionId,
  );
  if (
    confirmed.status !== "active" ||
    confirmed.cancel_at_period_end ||
    confirmed.schedule
  ) {
    throw new Error("Downgrade cancellation requires reconciliation");
  }
  await confirmGuardedCancellation(model, await readSubscription(tenantId));
}
