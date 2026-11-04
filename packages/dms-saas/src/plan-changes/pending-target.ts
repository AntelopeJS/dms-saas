import { GetModel } from "@antelopejs/interface-database-decorators";
import type { Plan, TenantSubscription } from "../db";
import { TenantSubscriptionModel } from "../db";
import { countOccupiedSeats } from "../plans/seat-capacity";
import {
  resetSubscriptionPendingState,
  scheduleSubscriptionDowngrade,
  setSubscriptionCancelAtPeriodEnd,
} from "../stripe/plan-schedule";

/** The plan a deferred change lands on, as Stripe bills it. */
export interface PendingTarget {
  planId: string;
  billingMode: Plan["billingMode"];
  stripePriceId: string | null;
}

/** A deferred change pointed at another plan, under the caller's admission. */
export interface PendingRedirect {
  tenantId: string;
  subscription: TenantSubscription;
  operationId: string;
  target: PendingTarget;
}

export function toPendingPatch(
  planId: string | null,
  effectiveAt: Date | null,
): Partial<TenantSubscription> {
  return {
    pendingPlanId: planId,
    pendingPlanChangeAt: effectiveAt,
    updatedAt: new Date(),
  };
}

/** The Stripe side of a plan, for {@link establishPendingTarget}. */
export function pendingTargetOf(plan: Plan): PendingTarget {
  return {
    planId: plan._id,
    billingMode: plan.billingMode,
    stripePriceId: plan.paymentProviderRefs?.stripePriceId ?? null,
  };
}

/** Stripe side of dropping a parked downgrade. The guard matters: without a
 * parked change there is nothing to lift, and resetting blindly would undo a
 * cancellation set outside the console. */
export async function releasePendingOnStripe(
  subscription: TenantSubscription,
): Promise<void> {
  if (!subscription.pendingPlanId) return;
  if (!subscription.stripeSubscriptionId) return;
  await resetSubscriptionPendingState(subscription.stripeSubscriptionId);
}

async function resolveSeatQuantity(
  tenantId: string,
  target: PendingTarget,
): Promise<number | undefined> {
  if (target.billingMode !== "seat") return undefined;
  return countOccupiedSeats(tenantId);
}

/** Establish the provider target while the caller retains subscription admission. */
export async function establishPendingTarget(
  tenantId: string,
  stripeSubscriptionId: string,
  target: PendingTarget,
): Promise<Date | null> {
  if (!target.stripePriceId) {
    return setSubscriptionCancelAtPeriodEnd(stripeSubscriptionId, true);
  }
  return scheduleSubscriptionDowngrade({
    stripeSubscriptionId,
    stripePriceId: target.stripePriceId,
    quantity: await resolveSeatQuantity(tenantId, target),
  });
}

/**
 * Points a workspace's deferred plan change at another plan, at the same
 * renewal: the Stripe schedule is rebuilt on the new target. A change that
 * would now land on the plan already in force is dropped instead.
 *
 * @returns When the change lands, null when it was dropped
 */
export async function redirectPendingPlanChange(
  redirect: PendingRedirect,
): Promise<Date | null> {
  const { tenantId, subscription, operationId, target } = redirect;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  await releasePendingOnStripe(subscription);
  const landsOnCurrentPlan = target.planId === subscription.planId;
  const effectiveAt =
    landsOnCurrentPlan || !subscription.stripeSubscriptionId
      ? null
      : await establishPendingTarget(
          tenantId,
          subscription.stripeSubscriptionId,
          target,
        );
  await model.updateDuringTransition(
    subscription._id,
    operationId,
    landsOnCurrentPlan
      ? toPendingPatch(null, null)
      : toPendingPatch(target.planId, effectiveAt),
  );
  return effectiveAt;
}
