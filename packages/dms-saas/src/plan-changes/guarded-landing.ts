import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { PlanChangeIncompatibility } from "@antelopejs/interface-dms-saas/plan-changes";
import {
  type GuardedPlanChange,
  type TenantSubscription,
  TenantSubscriptionModel,
  PlanModel,
} from "../db";
import { validateGuardedPlanChange } from "../implementations/dms-saas/plan-changes";
import { getStripeClient } from "../stripe/client";
import { recomputeTenantBillingState } from "../billing-state";
import { dispatchWorkspaceLifecycle } from "../operator-actions/lifecycle-outbox";
import {
  notifyTenantOwners,
  workspaceSuspendedSubject,
} from "../notifications";
import { drainPlanInventory, releasePlanInventory } from "./inventory-barrier";
import { abortGuardedPreparation, completeGuardedAbort } from "./guarded-state";
import { closePaidUsagePeriods } from "../workspaces/complimentary";
import { BLOCKING_STATUSES } from "../auth/subscription-access-gate";

const INVENTORY_PREPARATION_MAX_MS = 30_000;

/** Repeated reconciliation reuses the same durable delivery and notice IDs. */
async function notifyBlocked(
  tenantId: string,
  change: GuardedPlanChange,
): Promise<void> {
  await dispatchWorkspaceLifecycle({
    tenantId,
    operationId: `${change.operationId}:blocked`,
    planChangeOperationId: change.operationId,
    transition: "suspended",
    requestedAt: new Date(change.effectiveAt),
  });
  await notifyTenantOwners(tenantId, workspaceSuspendedSubject, {
    eventId: `free-downgrade:blocked:${change.operationId}`,
    icon: "i-ph-warning",
    title: "Free downgrade requires attention",
    description:
      "The paid period ended, but Free could not be safely activated. Execution is blocked; data is retained. Resolve the reported incompatibilities before resuming.",
  });
}

/**
 * Persists the downgrade incident. With `preserveProviderPhase`, unknown
 * provider effects retain their billing intent. Without it, a failed inventory
 * validation has no provider effect and must allow compatible remediation.
 */
async function recordBlocked(
  tenantId: string,
  current: TenantSubscription,
  issues: PlanChangeIncompatibility[],
  preserveProviderPhase = false,
): Promise<void> {
  const change = current.guardedPlanChange;
  if (!change) return;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const patch: Partial<TenantSubscription> = {
    guardedPlanChange: {
      ...change,
      phase: preserveProviderPhase ? change.phase : "blocked",
      incompatibilities: issues,
    },
  };
  if (!preserveProviderPhase) {
    patch.domainTransition = null;
    patch.paidUsagePeriods = closePaidUsagePeriods(
      current,
      new Date(change.effectiveAt),
    );
  }
  const outcome = await model.mutateRevision(current, patch);
  if (outcome !== "applied")
    throw new Error("Downgrade incident persistence requires reconciliation");
  await recomputeTenantBillingState(tenantId);
}

/**
 * The downgrade owns its marker, not the subscription status: a later payment
 * suspension must survive both a receipt and this final CAS.
 */
async function completeFreeActivation(
  tenantId: string,
  current: TenantSubscription,
): Promise<void> {
  const change = current.guardedPlanChange;
  if (!change || change.phase !== "activating") return;
  if (!BLOCKING_STATUSES.has(current.status)) {
    await dispatchWorkspaceLifecycle({
      tenantId,
      operationId: `${change.operationId}:reactivate`,
      planChangeOperationId: change.operationId,
      transition: "reactivation_requested",
      requestedAt: new Date(change.effectiveAt),
    });
  }
  const outcome = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).mutateRevision(current, {
    guardedPlanChange: null,
    pendingPlanId: null,
    pendingPlanChangeAt: null,
    domainTransition: null,
  });
  if (outcome !== "applied")
    throw new Error("Free activation requires reconciliation");
  await recomputeTenantBillingState(tenantId);
}

/** CAS-revoke inventory-only work; never expire or replay provider admission. */
async function recoverInventoryPreparation(
  tenantId: string,
  current: TenantSubscription,
  change: GuardedPlanChange,
): Promise<boolean> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  if (change.phase === "preparing") {
    if (
      Date.now() - new Date(change.requestedAt).getTime() >=
      INVENTORY_PREPARATION_MAX_MS
    ) {
      await abortGuardedPreparation(model, current);
      await releasePlanInventory(tenantId, change);
      const aborted = await model.findOne();
      if (
        aborted?.guardedPlanChange?.operationId === change.operationId &&
        aborted.guardedPlanChange.phase === "aborting"
      ) {
        await completeGuardedAbort(model, aborted);
      }
    }
    return true;
  }
  if (change.phase === "aborting") {
    await releasePlanInventory(tenantId, change);
    await completeGuardedAbort(model, current);
    return true;
  }
  if (change.phase === "effective") {
    if (
      change.validationStartedAt &&
      Date.now() - new Date(change.validationStartedAt).getTime() >=
        INVENTORY_PREPARATION_MAX_MS
    ) {
      await recordBlocked(tenantId, current, [
        {
          code: "validation_interrupted",
          message: "Inventory validation did not finish",
        },
      ]);
      await releasePlanInventory(tenantId, change);
      await notifyBlocked(tenantId, change);
    }
    return true;
  }
  return false;
}

/**
 * Consume guarded cancellations even when landing is blocked: falling through
 * to ordinary cancellation would eventually invoke retention deletion.
 * Stripe is read before inventory closure and never mutated by this landing.
 * Phases that no longer need inventory closure still release it while keeping
 * the identity, which makes a crash between the phase CAS and the barrier
 * release recoverable. A prior suspension delivery is finished before its
 * inverse is allowed: durable delivery identities prevent a late retry from
 * reversing a later resume.
 */
export async function reconcileGuardedFreeChange(
  tenantId: string,
): Promise<boolean> {
  const current = await GetModel(TenantSubscriptionModel, tenantId).findOne();
  const change = current?.guardedPlanChange;
  if (!current || !change) return false;
  if (await recoverInventoryPreparation(tenantId, current, change)) return true;
  await releasePlanInventory(tenantId, change);
  if (change.phase === "activating") {
    await completeFreeActivation(tenantId, current);
    return true;
  }
  if (new Date(change.effectiveAt).getTime() > Date.now()) return true;
  if (!["scheduled", "blocked"].includes(change.phase)) {
    await recordBlocked(
      tenantId,
      current,
      [
        {
          code: "billing_reconciliation_required",
          message: "A billing or inventory operation has not settled",
        },
      ],
      true,
    );
    await notifyBlocked(tenantId, change);
    return true;
  }
  if (change.phase === "blocked") await notifyBlocked(tenantId, change);
  try {
    const live = await getStripeClient().subscriptions.retrieve(
      change.stripeSubscriptionId,
    );
    if (live.status !== "canceled")
      throw new Error("Stripe has not confirmed cancellation");
  } catch {
    await recordBlocked(tenantId, current, [
      {
        code: "provider_not_cancelled",
        message: "Provider cancellation could not be confirmed",
      },
    ]);
    await notifyBlocked(tenantId, change);
    return true;
  }
  await validateAndCommitFree(tenantId, current, change);
  return true;
}

/** Hold only inventory validation and its CAS commit behind the barrier. */
async function validateAndCommitFree(
  tenantId: string,
  current: TenantSubscription,
  change: GuardedPlanChange,
): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const effective: GuardedPlanChange = {
    ...change,
    phase: "effective",
    barrierId: randomUUID(),
    validationStartedAt: new Date(),
  };
  if (
    (await model.mutateRevision(current, { guardedPlanChange: effective })) !==
    "applied"
  ) {
    throw new Error("Another landing attempt changed the subscription");
  }
  try {
    const drained = await drainPlanInventory(tenantId, model, effective);
    const targetPlan = await GetModel(PlanModel).get(change.targetPlanId);
    if (
      !targetPlan ||
      targetPlan.price !== 0 ||
      targetPlan.paymentProviderRefs?.stripePriceId
    ) {
      throw new Error("The target is no longer a Free plan");
    }
    const issues = await validateGuardedPlanChange(
      {
        tenantId,
        currentPlan: drained.planId
          ? ((await GetModel(PlanModel).get(drained.planId)) ?? null)
          : null,
        targetPlan,
        operationId: change.operationId,
        phase: "effective",
        effectiveAt: new Date(change.effectiveAt),
      },
      change.policyName,
    );
    if (issues.length) {
      await recordBlocked(tenantId, drained, issues);
    } else {
      const outcome = await model.mutateRevision(drained, {
        planId: targetPlan._id,
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
        paidUsagePeriods: closePaidUsagePeriods(
          drained,
          new Date(change.effectiveAt),
        ),
        guardedPlanChange: {
          ...effective,
          phase: "activating",
          incompatibilities: [],
        },
        domainTransition: null,
      });
      if (outcome !== "applied")
        throw new Error("Free landing revision changed");
    }
  } catch (error) {
    const latest = await model.findOne();
    if (
      latest?.guardedPlanChange?.barrierId === effective.barrierId &&
      latest.guardedPlanChange.phase === "effective"
    ) {
      await recordBlocked(tenantId, latest, [
        {
          code: "validation_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "Inventory validation unavailable",
        },
      ]);
    } else {
      throw error;
    }
  } finally {
    await releasePlanInventory(tenantId, effective);
  }
  const latest = await model.findOne();
  if (latest?.guardedPlanChange?.phase === "blocked")
    await notifyBlocked(tenantId, latest.guardedPlanChange);
  else if (latest) await completeFreeActivation(tenantId, latest);
}
