import { randomUUID } from "node:crypto";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { recomputeTenantBillingState } from "../billing-state";
import type { Plan, TenantSubscription } from "../db";
import { PlanModel, TenantSubscriptionModel } from "../db";
import { notifyTenantOwners, seatOverageSubject } from "../notifications";
import {
  countOccupiedSeats,
  fitsWithinSeatLimit,
} from "../plans/seat-capacity";
import { syncStripeSeatQuantity } from "../plans/seat-sync";
import { getStripeClient } from "../stripe/client";
import {
  resetSubscriptionPendingState,
  scheduleSubscriptionDowngrade,
  setSubscriptionCancelAtPeriodEnd,
} from "../stripe/plan-schedule";
import { applyPlanDowngradeCleanup } from "../workers/plan-migration";

const ACTIVE_STATUS = "active" as const;
const DUNNING_STATUSES = new Set<TenantSubscription["status"]>([
  "past_due",
  "suspended",
]);
const SEAT_OVERAGE_ICON = "i-ph-users-three";

export interface PendingPlanChange {
  planId: string;
  planName: string;
  effectiveAt: Date | null;
}

export interface ScheduleDeferredChangeParams {
  tenantId: string;
  subscription: TenantSubscription;
  targetPlan: Plan;
}

function toPendingPatch(
  planId: string | null,
  effectiveAt: Date | null,
): Partial<TenantSubscription> {
  return {
    pendingPlanId: planId,
    pendingPlanChangeAt: effectiveAt,
    updatedAt: new Date(),
  };
}

/** Stripe side of dropping a parked downgrade. The guard matters: without a
 * parked change there is nothing to lift, and resetting blindly would undo a
 * cancellation set outside the console. */
async function releasePendingOnStripe(
  subscription: TenantSubscription,
): Promise<void> {
  if (!subscription.pendingPlanId) return;
  if (!subscription.stripeSubscriptionId) return;
  await resetSubscriptionPendingState(subscription.stripeSubscriptionId);
}

export async function clearPendingPlanChange(
  tenantId: string,
  subscription: TenantSubscription,
  operationId?: string,
): Promise<void> {
  if (!subscription.pendingPlanId) return;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const intentId = operationId ?? randomUUID();
  if (!operationId)
    await model.beginTransition(subscription, {
      operationId: intentId,
      kind: "change_plan",
      targetPlanId: null,
      requestedAt: new Date(),
    });
  await releasePendingOnStripe(subscription);
  if (operationId) {
    await model.updateDuringTransition(
      subscription._id,
      operationId,
      toPendingPatch(null, null),
    );
    return;
  }
  await model.completeTransition(
    subscription._id,
    intentId,
    toPendingPatch(null, null),
  );
}

async function resolveSeatQuantity(
  tenantId: string,
  plan: Plan,
): Promise<number | undefined> {
  if (plan.billingMode !== "seat") return undefined;
  return countOccupiedSeats(tenantId);
}

/** Establish the provider target while the caller retains subscription admission. */
async function establishPendingTarget(
  tenantId: string,
  subscription: TenantSubscription,
  targetPlan: Plan,
): Promise<Date | null> {
  const stripeSubscriptionId = subscription.stripeSubscriptionId as string;
  const stripePriceId = targetPlan.paymentProviderRefs?.stripePriceId;

  if (!stripePriceId) {
    return setSubscriptionCancelAtPeriodEnd(stripeSubscriptionId, true);
  }

  return scheduleSubscriptionDowngrade({
    stripeSubscriptionId,
    stripePriceId,
    quantity: await resolveSeatQuantity(tenantId, targetPlan),
  });
}

/** Retain intent on failure; compensating an ambiguous provider request is unsafe. */
export async function scheduleDeferredPlanChange(
  params: ScheduleDeferredChangeParams,
): Promise<Date | null> {
  const { tenantId, subscription, targetPlan } = params;
  if (!subscription.stripeSubscriptionId) return null;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const operationId = randomUUID();
  await model.beginTransition(subscription, {
    operationId,
    kind: "change_plan",
    targetPlanId: targetPlan._id,
    requestedAt: new Date(),
  });
  await releasePendingOnStripe(subscription);
  const effectiveAt = await establishPendingTarget(
    tenantId,
    subscription,
    targetPlan,
  );
  await model.completeTransition(
    subscription._id,
    operationId,
    toPendingPatch(targetPlan._id, effectiveAt),
  );
  return effectiveAt;
}

/**
 * The seat-fit check at scheduling time guards the plan the workspace was on;
 * members added during the cycle can land the workspace above the target
 * plan's cap by commit time. Stripe has already billed the cheaper plan when
 * this runs, so the downgrade is applied and the overage is surfaced to the
 * owners — seat enforcement already blocks further additions.
 */
async function notifySeatOverageIfAny(
  tenantId: string,
  pendingPlan: Plan,
): Promise<void> {
  const occupiedSeats = await countOccupiedSeats(tenantId);
  if (fitsWithinSeatLimit(pendingPlan.maxMembers, occupiedSeats)) return;
  await notifyTenantOwners(tenantId, seatOverageSubject, {
    icon: SEAT_OVERAGE_ICON,
    title: "$saas.notifications.payload.seat_overage.title",
    description: "$saas.notifications.payload.seat_overage.description",
  });
}

/** Admit the landing once; failed cleanup retains intent rather than replaying blindly. */
async function commitPendingPlan(
  tenantId: string,
  subscription: TenantSubscription,
  pendingPlan: Plan,
  patch: Partial<TenantSubscription>,
): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const operationId = randomUUID();
  await model.beginTransition(subscription, {
    operationId,
    kind: "change_plan",
    targetPlanId: pendingPlan._id,
    requestedAt: new Date(),
  });
  await applyPlanDowngradeCleanup(tenantId, pendingPlan);
  await syncStripeSeatQuantity({
    tenantId,
    plan: pendingPlan,
    // The free-plan landing drops the Stripe subscription in the same patch;
    // seats must not be synced against the one that just went away.
    stripeSubscriptionId:
      "stripeSubscriptionId" in patch
        ? (patch.stripeSubscriptionId ?? null)
        : subscription.stripeSubscriptionId,
    idempotencyKey: `seat-sync:deferred:${operationId}`,
  });
  await model.completeTransition(subscription._id, operationId, {
    planId: pendingPlan._id,
    ...toPendingPatch(null, null),
    ...patch,
  });
  // Best-effort past this point: the marker is gone, so failing the webhook
  // would not replay the commit — worse, on the free-plan landing the
  // redelivery would find no pending change and take the cancellation branch,
  // cancelling a downgrade that just succeeded. The billing-state cron
  // re-derives this within its own schedule anyway.
  await recomputeTenantBillingState(tenantId).catch((error) => {
    Logging.Error(
      `[dms-saas:plan-changes] billing-state recompute failed after committing plan ${pendingPlan._id} for tenant ${tenantId}`,
      error,
    );
  });
  // A notification must never block billing sync, and failing the webhook
  // would not resend it anyway — the redelivery exits early once the pending
  // plan is cleared.
  await notifySeatOverageIfAny(tenantId, pendingPlan).catch(() => undefined);
}

async function loadPendingPlan(
  subscription: TenantSubscription | undefined,
): Promise<Plan | undefined> {
  if (!subscription?.pendingPlanId) return undefined;
  const planModel = GetModel(PlanModel);
  return planModel.get(subscription.pendingPlanId);
}

function toActivePriceId(
  stripeSubscription: Stripe.Subscription,
): string | null {
  return stripeSubscription.items.data[0]?.price?.id ?? null;
}

function holdsPendingState(stripeSubscription: Stripe.Subscription): boolean {
  return (
    !!stripeSubscription.schedule || stripeSubscription.cancel_at_period_end
  );
}

/**
 * Realigns the mirrored plan with the billed price, nothing more. No role
 * cleanup here: the plan permissions resolver already intersects effective
 * permissions with the plan on every resolution, so enforcement never relies
 * on it — and a destructive rewrite of tenant roles has no place in an
 * automatic detection path that also covers upgrades.
 */
async function adoptBilledPlan(
  tenantId: string,
  subscription: TenantSubscription,
  stripeSubscription: Stripe.Subscription,
): Promise<void> {
  const activePriceId = toActivePriceId(stripeSubscription);
  if (!activePriceId) return;
  const planModel = GetModel(PlanModel);
  const currentPlan = subscription.planId
    ? await planModel.get(subscription.planId)
    : null;
  const currentPriceId = currentPlan?.paymentProviderRefs?.stripePriceId;
  if (currentPriceId === activePriceId) {
    return;
  }
  // Same rule as dropping a parked change: rewriting the plan is destructive
  // and events carry no ordering guarantee, so an update emitted before a
  // phase change must not roll the mirror back to the previously billed
  // price. Only the subscription's live state decides.
  const fresh = await getStripeClient().subscriptions.retrieve(
    stripeSubscription.id,
  );
  const freshPriceId = toActivePriceId(fresh);
  if (!freshPriceId || freshPriceId === currentPriceId) return;
  const plans = await planModel.findNotDeleted();
  const billedPlan = plans.find(
    (plan) => plan.paymentProviderRefs?.stripePriceId === freshPriceId,
  );
  if (!billedPlan) return;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  await model.update(subscription._id, {
    planId: billedPlan._id,
    updatedAt: new Date(),
  });
  await recomputeTenantBillingState(tenantId);
}

/**
 * Data-driven safety net run on every subscription update: whatever an
 * aborted re-scheduling or a crashed process left behind, the mirror
 * converges to what Stripe actually holds. A parked change Stripe no longer
 * knows is dropped, and the local plan follows the billed price — so billing
 * and entitlements realign by the next event at the latest.
 */
export async function reconcilePendingWithStripe(
  tenantId: string,
  stripeSubscription: Stripe.Subscription,
): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const local = await model.findOne();
  if (!local) return;
  if (local.pendingPlanId && !holdsPendingState(stripeSubscription)) {
    // Stripe does not guarantee delivery order: an update emitted before the
    // downgrade was parked can arrive after it. Dropping the parked change is
    // destructive, so it only happens against the subscription's live state,
    // never against the payload alone.
    const fresh = await getStripeClient().subscriptions.retrieve(
      stripeSubscription.id,
    );
    if (!holdsPendingState(fresh)) {
      await model.update(local._id, toPendingPatch(null, null));
    }
  }
  await adoptBilledPlan(tenantId, local, stripeSubscription);
}

/**
 * Applies a parked downgrade once Stripe has actually entered the new phase,
 * recognised by the subscription now billing the pending plan's price.
 */
export async function applyPendingPlanChangeIfEntered(
  tenantId: string,
  stripeSubscription: Stripe.Subscription,
): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await model.findOne();
  const pendingPlan = await loadPendingPlan(subscription);
  if (!subscription || !pendingPlan) return;
  const pendingPriceId = pendingPlan.paymentProviderRefs?.stripePriceId;
  if (!pendingPriceId) return;
  if (toActivePriceId(stripeSubscription) !== pendingPriceId) return;
  await commitPendingPlan(tenantId, subscription, pendingPlan, {});
}

/**
 * A subscription cancelled at cycle end while a free plan was parked is a
 * completed downgrade, not a cancellation: the workspace stays active.
 */
export async function applyPendingFreePlanOnCancellation(
  tenantId: string,
): Promise<boolean> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const subscription = await model.findOne();
  const pendingPlan = await loadPendingPlan(subscription);
  if (!subscription || !pendingPlan) return false;
  // Only a genuinely free target may land without a Stripe subscription; a
  // priced plan that lost its Stripe ref must fall through to the regular
  // cancellation path rather than being granted for free.
  if (pendingPlan.paymentProviderRefs?.stripePriceId) return false;
  if (pendingPlan.price > 0) return false;
  // A dunning episode survives the landing: when the final cycle's invoice
  // went unpaid before Stripe cancelled at period end, granting `active`
  // here would let the workspace walk away from that invoice. The plan still
  // lands; the status (and its pastDueSince clock) clears on invoice.paid.
  const preservedStatus = DUNNING_STATUSES.has(subscription.status)
    ? subscription.status
    : ACTIVE_STATUS;
  await commitPendingPlan(tenantId, subscription, pendingPlan, {
    status: preservedStatus,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
  });
  return true;
}

export function toPendingPlanChange(
  subscription: TenantSubscription | undefined,
  pendingPlan: Plan | null | undefined,
): PendingPlanChange | null {
  if (!subscription?.pendingPlanId || !pendingPlan) return null;
  return {
    planId: pendingPlan._id,
    planName: pendingPlan.name,
    effectiveAt: subscription.pendingPlanChangeAt ?? null,
  };
}
