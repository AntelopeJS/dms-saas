// The plan-change operations behind the controller in tenant-plan.ts, split out
// to keep both files under the size the linter allows. They are also called
// directly by the operator actions, which is why they stay exported.

import { randomUUID } from "node:crypto";
import { assert } from "@antelopejs/interface-api-util";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { recomputeTenantBillingState } from "../../billing-state";
import {
  type Plan,
  type PaidUsagePeriod,
  type SubscriptionTransition,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import {
  clearPendingPlanChange,
  type PendingPlanChange,
  scheduleDeferredPlanChange,
} from "../../plan-changes";
import {
  countOccupiedSeats,
  ensurePlanStripeRefs,
  fitsWithinSeatLimit,
  syncStripeSeatQuantity,
  type TenantPlanFeature,
  type TenantPlanView,
} from "../../plans";
import { getStripeClient } from "../../stripe/client";
import { applyPlanDowngradeCleanup } from "../../workers";

export const HTTP_NOT_FOUND = 404;
export const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_CONFLICT = 409;
export const PAST_DUE_STATUS: TenantSubscriptionStatus = "past_due";
const PRORATION_BEHAVIOR = "create_prorations" as const;
const ACTIVE_STATUS = "active" as const;

export interface ChangePlanBody {
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface ChangePlanResult {
  changed: boolean;
  scheduled: boolean;
  planId: string;
  effectiveAt: Date | null;
  checkoutUrl: string | null;
}

export interface CurrentPlanResult {
  current: Plan | null;
  available: TenantPlanView[];
  features: TenantPlanFeature[];
  status: string | null;
  freeUntil: Date | null;
  isComplimentary: boolean;
  isPlanChangeLocked: boolean;
  canRecoverComplimentary: boolean;
  paidUsageStartedAt: Date | null;
  paidUsagePeriods: PaidUsagePeriod[] | null;
  currentPeriodEnd: Date | null;
  pendingPlan: PendingPlanChange | null;
}

export interface PlanChangeRequest {
  tenantId: string;
  user: User;
  newPlan: Plan;
  body: ChangePlanBody;
  subscription: TenantSubscription | undefined;
  tenantSubscriptionModel: TenantSubscriptionModel;
}

export const UNCHANGED_RESULT_BASE = {
  changed: false,
  scheduled: false,
  effectiveAt: null,
  checkoutUrl: null,
} as const;

/**
 * Guards every path that selects a plan, self-serve or platform-owner acting
 * on the tenant's behalf, so no caller can reach a deleted, mistargeted or
 * unbilled plan.
 */
export async function loadAndValidateTargetPlan(
  planModel: PlanModel,
  planId: string,
  customerType: string | null | undefined,
): Promise<Plan> {
  const storedPlan = await planModel.get(planId);
  assert(
    storedPlan && !storedPlan.isDeleted && storedPlan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.invalid",
  );
  assert(
    customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.customer_type_unknown",
  );
  assert(
    storedPlan.audience === "any" || storedPlan.audience === customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
  // Whatever wrote the plan, it is billed on a price that matches it.
  const newPlan = await ensurePlanStripeRefs(storedPlan, planModel);
  // A priced plan with no Stripe price must not be selectable: isPaidPlan
  // keys off the Stripe ref, so an unsynced paid plan would be parked as a
  // free downgrade and land active without ever being billed.
  assert(
    newPlan.price <= 0 || !!newPlan.paymentProviderRefs?.stripePriceId,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_synced_with_stripe",
  );
  return newPlan;
}

/**
 * A plan change must never strand more occupied seats than the target plan
 * allows; 402 rather than 400 because freeing seats or paying more are both
 * valid ways out.
 */
export async function assertSeatLimit(
  tenantId: string,
  plan: Plan,
): Promise<void> {
  const occupiedSeats = await countOccupiedSeats(tenantId);
  assert(
    fitsWithinSeatLimit(plan.maxMembers, occupiedSeats),
    HTTP_PAYMENT_REQUIRED,
    "saas.errors.plan.downgrade_exceeds_seat_limit",
  );
}

async function applyPlanChange(
  subscription: TenantSubscription,
  newPlan: Plan,
  newPlanId: string,
  tenantSubscriptionModel: TenantSubscriptionModel,
  operationId: string,
): Promise<void> {
  await syncStripePlanChange(subscription, newPlan, operationId);
  await tenantSubscriptionModel.updateDuringTransition(
    subscription._id,
    operationId,
    {
      planId: newPlanId,
      updatedAt: new Date(),
    },
  );
}

/** Complete retryable work that follows an immediate plan write. */
export async function finalizeImmediateChange(
  tenantId: string,
  subscription: TenantSubscription,
  newPlan: Plan,
): Promise<void> {
  await applyPlanDowngradeCleanup(tenantId, newPlan);
  await syncStripeSeatQuantity({
    tenantId,
    plan: newPlan,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    idempotencyKey: `seat-sync:change-plan:${tenantId}:${subscription._id}:${newPlan._id}`,
  });
  await recomputeTenantBillingState(tenantId);
}

async function syncStripePlanChange(
  subscription: TenantSubscription,
  newPlan: Plan,
  operationId: string,
): Promise<void> {
  if (!subscription.stripeSubscriptionId) return;
  const stripePriceId = newPlan.paymentProviderRefs?.stripePriceId;
  assert(stripePriceId, HTTP_BAD_REQUEST, "saas.errors.plan.no_stripe_price");
  const stripe = getStripeClient();
  const stripeSubscription = await stripe.subscriptions.retrieve(
    subscription.stripeSubscriptionId,
  );
  const itemId = stripeSubscription.items.data[0]?.id;
  assert(itemId, HTTP_BAD_REQUEST, "saas.errors.stripe.subscription_no_item");
  await stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    {
      items: [{ id: itemId, price: stripePriceId }],
      proration_behavior: PRORATION_BEHAVIOR,
      automatic_tax: { enabled: true },
    },
    {
      idempotencyKey: `change-plan:${operationId}`,
    },
  );
}

/**
 * Paid means "billable through Stripe", keyed on the synced price ref: a
 * priced plan that was never synced must not be treated as payable.
 */
export function isPaidPlan(plan: Plan): boolean {
  return !!plan.paymentProviderRefs?.stripePriceId;
}

export async function insertFreeSubscription(
  user: User,
  newPlanId: string,
  tenantId: string,
  tenantSubscriptionModel: TenantSubscriptionModel,
): Promise<ChangePlanResult> {
  await runTenantLifecycleOperation(tenantId, () =>
    tenantSubscriptionModel.insert([
      {
        _id: tenantId,
        planId: newPlanId,
        status: ACTIVE_STATUS,
        isComplimentary: false,
        paidUsagePeriods: [],
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
        createdBy: user._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  );
  await recomputeTenantBillingState(tenantId);
  return {
    ...UNCHANGED_RESULT_BASE,
    changed: true,
    planId: newPlanId,
  };
}

export async function scheduleDowngrade(
  tenantId: string,
  subscription: TenantSubscription,
  newPlan: Plan,
): Promise<ChangePlanResult> {
  const effectiveAt = await scheduleDeferredPlanChange({
    tenantId,
    subscription,
    targetPlan: newPlan,
  });
  await recomputeTenantBillingState(tenantId);
  return {
    ...UNCHANGED_RESULT_BASE,
    scheduled: true,
    planId: newPlan._id,
    effectiveAt,
  };
}

export async function dropPendingChange(
  tenantId: string,
  subscription: TenantSubscription,
): Promise<ChangePlanResult> {
  await clearPendingPlanChange(tenantId, subscription);
  await recomputeTenantBillingState(tenantId);
  return {
    ...UNCHANGED_RESULT_BASE,
    changed: true,
    planId: subscription.planId ?? "",
  };
}

/**
 * The immediate, prorated plan change: drops any parked downgrade, syncs
 * Stripe, then recomputes the derived billing state. The platform back-office
 * calls this for manual upgrades so both paths share one set of rules.
 */
export async function applyImmediateChange(
  tenantId: string,
  subscription: TenantSubscription,
  newPlan: Plan,
  tenantSubscriptionModel: TenantSubscriptionModel,
  operatorIntent?: SubscriptionTransition,
): Promise<ChangePlanResult> {
  const intent =
    operatorIntent ??
    ({
      operationId: randomUUID(),
      kind: "change_plan",
      targetPlanId: newPlan._id,
      requestedAt: new Date(),
    } satisfies SubscriptionTransition);
  await tenantSubscriptionModel.beginTransition(subscription, intent);
  await clearPendingPlanChange(tenantId, subscription, intent.operationId);
  await applyPlanChange(
    subscription,
    newPlan,
    newPlan._id,
    tenantSubscriptionModel,
    intent.operationId,
  );
  await finalizeImmediateChange(tenantId, subscription, newPlan);
  if (!operatorIntent)
    await tenantSubscriptionModel.completeTransition(
      subscription._id,
      intent.operationId,
      {},
    );
  return { ...UNCHANGED_RESULT_BASE, changed: true, planId: newPlan._id };
}
