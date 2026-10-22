import type {
  GuardedPlanChange,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../db";

/** A deadline closes paid execution independently of webhook delivery. */
export function isGuardedPlanChangeBlocked(
  subscription: TenantSubscription,
  now = new Date(),
): boolean {
  const change = subscription.guardedPlanChange;
  if (!change) return false;
  if (change.phase === "aborting") return false;
  return (
    change.phase === "blocked" ||
    new Date(change.effectiveAt).getTime() <= now.getTime()
  );
}

async function compareAndSet(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
  patch: Partial<TenantSubscription>,
): Promise<void> {
  if (current.deletionStartedAt)
    throw new Error("Subscription deletion has started");
  if ((await model.mutateRevision(current, patch)) !== "applied") {
    throw new Error(
      "Plan change revision changed; reload without replaying provider effects",
    );
  }
}

/** Publish the target before draining writers. No provider effect is admitted yet. */
export async function prepareGuardedPlanChange(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
  change: GuardedPlanChange,
): Promise<void> {
  if (
    current.domainTransition ||
    current.guardedPlanChange ||
    current.pendingPlanId
  ) {
    throw new Error("An existing plan transition requires reconciliation");
  }
  if (
    change.phase !== "preparing" ||
    current.stripeSubscriptionId !== change.stripeSubscriptionId
  ) {
    throw new Error("Invalid downgrade preparation");
  }
  await compareAndSet(model, current, {
    guardedPlanChange: change,
    pendingPlanId: change.targetPlanId,
    pendingPlanChangeAt: change.effectiveAt,
    domainTransition: {
      operationId: change.operationId,
      kind: "change_plan",
      targetPlanId: change.targetPlanId,
      requestedAt: change.requestedAt,
    },
  });
}

/**
 * CAS-abort is legal only before provider admission. A stale preparer holding
 * the previous revision cannot subsequently acquire permission to call Stripe.
 */
export async function abortGuardedPreparation(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  const change = requirePhase(current, "preparing");
  await compareAndSet(model, current, {
    guardedPlanChange: { ...change, phase: "aborting" },
  });
}

/** Keep the barrier identity durable until its release has been acknowledged. */
export async function completeGuardedAbort(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  requirePhase(current, "aborting");
  await compareAndSet(model, current, {
    guardedPlanChange: null,
    pendingPlanId: null,
    pendingPlanChangeAt: null,
    domainTransition: null,
  });
}

function requirePhase(
  current: TenantSubscription,
  phase: GuardedPlanChange["phase"],
): GuardedPlanChange {
  const change = current.guardedPlanChange;
  if (!change || change.phase !== phase)
    throw new Error(`Expected downgrade phase ${phase}`);
  if (
    current.domainTransition &&
    current.domainTransition.operationId !== change.operationId
  ) {
    throw new Error("Another billing intent owns the subscription");
  }
  return change;
}

/** Only the caller whose CAS succeeds may emit this operation's Stripe request. */
export async function admitGuardedProviderEffect(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  const change = requirePhase(current, "preparing");
  await compareAndSet(model, current, {
    guardedPlanChange: { ...change, phase: "provider_pending" },
  });
}

/** Called by the same emitter after its request and provider confirmation succeed. */
export async function confirmGuardedSchedule(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  const change = requirePhase(current, "provider_pending");
  await compareAndSet(model, current, {
    guardedPlanChange: { ...change, phase: "scheduled" },
    domainTransition: null,
  });
}

/** Never invert an uncertain request; a GET is not proof that an old emitter stopped. */
export async function admitGuardedCancellation(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  const change = requirePhase(current, "scheduled");
  if (isGuardedPlanChangeBlocked(current))
    throw new Error("The downgrade deadline has passed");
  await compareAndSet(model, current, {
    guardedPlanChange: { ...change, phase: "cancel_pending" },
    domainTransition: {
      operationId: change.operationId,
      kind: "change_plan",
      targetPlanId: null,
      requestedAt: change.requestedAt,
    },
  });
}

/** Keep target constraints until the admitted cancellation has been acknowledged. */
export async function confirmGuardedCancellation(
  model: TenantSubscriptionModel,
  current: TenantSubscription,
): Promise<void> {
  requirePhase(current, "cancel_pending");
  await compareAndSet(model, current, {
    guardedPlanChange: null,
    pendingPlanId: null,
    pendingPlanChangeAt: null,
    domainTransition: null,
  });
}
