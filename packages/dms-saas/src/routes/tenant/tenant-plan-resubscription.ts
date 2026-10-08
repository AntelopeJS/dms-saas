// A cancelled workspace coming back on a free plan. The subscription row is
// kept, with its Stripe customer, its card and its refund record, and moves
// off the subscription Stripe ended onto a local free one, as registration
// opens it. A paid plan goes through Checkout instead (tenant-plan-checkout.ts),
// which reuses the same customer.

import { assert } from "@antelopejs/interface-api-util";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { recomputeTenantBillingState } from "../../billing-state";
import type {
  Plan,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { applyPlanDowngradeCleanup } from "../../workers";
import { closePaidUsagePeriods } from "../../workspaces/complimentary";
import { canResubscribe } from "../../workspaces/first-payment";
import {
  assertCardMayBackFreeWorkspace,
  isFreePerCardPolicyActive,
  resolveFreeWorkspacesPerCard,
  withCardHold,
} from "../../workspaces/free-workspaces-per-card";
import { releaseAbandonedCheckout } from "./tenant-plan-checkout-recovery";
import {
  type ChangePlanResult,
  HTTP_CONFLICT,
  type PlanChangeRequest,
  UNCHANGED_RESULT_BASE,
} from "./tenant-plan-ops";

const ACTIVE_STATUS = "active" as const;
const CHECKOUT_KIND = "checkout";

/** The local free subscription a cancelled workspace resumes on. */
function freeResumptionPatch(
  subscription: TenantSubscription,
  plan: Plan,
  now: Date,
): Partial<TenantSubscription> {
  return {
    planId: plan._id,
    status: ACTIVE_STATUS,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    currentPeriodEnd: null,
    pendingPlanId: null,
    pendingPlanChangeAt: null,
    isComplimentary: false,
    freeUntil: null,
    paidUsageStartedAt: null,
    paidUsagePeriods: closePaidUsagePeriods(subscription, now),
    cronNotification: null,
    updatedAt: now,
  };
}

/**
 * The workspace is still cancelled, with no checkout or other change under
 * way: an open checkout is the owner's to finish or give up first.
 */
async function loadResumableSubscription(
  request: PlanChangeRequest,
): Promise<TenantSubscription> {
  const model = request.tenantSubscriptionModel;
  const stored = await model.findOne();
  assert(
    stored && canResubscribe(stored),
    HTTP_CONFLICT,
    "saas.errors.plan.change_in_progress",
  );
  const subscription = await releaseAbandonedCheckout(stored, model);
  assert(
    !subscription.domainTransition,
    HTTP_CONFLICT,
    subscription.domainTransition?.kind === CHECKOUT_KIND
      ? "saas.errors.plan.checkout_in_progress"
      : "saas.errors.plan.change_in_progress",
  );
  return subscription;
}

/**
 * A card backs only so many free workspaces: a cancelled workspace resting
 * on one counts against it again once it is free.
 */
async function writeFreeResumption(
  subscription: TenantSubscription,
  plan: Plan,
  model: TenantSubscriptionModel,
): Promise<void> {
  const fingerprint = subscription.cardFingerprint ?? null;
  const limit = await resolveFreeWorkspacesPerCard();
  const isCardCounted = !!fingerprint && isFreePerCardPolicyActive(limit);
  await withCardHold(isCardCounted ? fingerprint : null, async () => {
    if (isCardCounted) await assertCardMayBackFreeWorkspace(fingerprint, limit);
    await model.update(
      subscription._id,
      freeResumptionPatch(subscription, plan, new Date()),
    );
  });
}

/**
 * Brings a cancelled workspace back on a free plan, at once and with its
 * data. The caller has checked the plan is sellable and fits the seats.
 *
 * @param request The owner's plan change, on a free plan
 */
export async function resubscribeOnFreePlan(
  request: PlanChangeRequest,
): Promise<ChangePlanResult> {
  const { tenantId, newPlan, tenantSubscriptionModel } = request;
  await runTenantLifecycleOperation(tenantId, async () =>
    writeFreeResumption(
      await loadResumableSubscription(request),
      newPlan,
      tenantSubscriptionModel,
    ),
  );
  await applyPlanDowngradeCleanup(tenantId, newPlan);
  await recomputeTenantBillingState(tenantId);
  return { ...UNCHANGED_RESULT_BASE, changed: true, planId: newPlan._id };
}
