// The plan-change operations behind the controller in tenant-plan.ts, split out
// to keep both files under the size the linter allows. They are also called
// directly by the operator actions, which is why they stay exported.

import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
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
import Stripe from "stripe";
import { getStripeClient } from "../../stripe/client";
import {
  discardPendingUpdate,
  readPendingChallengeSecret,
} from "../../stripe/pending-update";
import { applyPlanDowngradeCleanup } from "../../workers";

export const HTTP_NOT_FOUND = 404;
export const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_CONFLICT = 409;
export const PAST_DUE_STATUS: TenantSubscriptionStatus = "past_due";
const ACTIVE_STATUS = "active" as const;
const SEAT_BILLING_MODE = "seat";
const FLAT_QUANTITY = 1;
// An immediate change the owner pays for only lands on Stripe once its invoice
// is paid: a card that needs 3D Secure leaves it pending for the owner to
// authenticate, where `error_if_incomplete` would refuse it as declined.
const PAID_UPGRADE_PAYMENT_BEHAVIOR = "pending_if_incomplete" as const;

export interface ChangePlanBody {
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
  /**
   * Stripe seconds the owner's reviewed preview was priced at, so the
   * prorated charge matches the amount the confirm button named.
   */
  prorationDate?: number;
}

/** How an immediate change bills the difference with the plan it leaves. */
export interface ImmediateChangeBilling {
  /**
   * `create_prorations` adds the difference to the next invoice (operator
   * changes); `always_invoice` charges it at once (an owner's upgrade).
   */
  prorationBehavior: "create_prorations" | "always_invoice";
  prorationDate?: number;
}

/** Operator changes: the difference waits for the next invoice. */
const DEFERRED_PRORATION_BILLING: ImmediateChangeBilling = {
  prorationBehavior: "create_prorations",
};

interface StripePlanChange {
  subscription: TenantSubscription;
  newPlan: Plan;
  operationId: string;
  billing: ImmediateChangeBilling;
}

/** The payment the owner must authenticate before an upgrade applies. */
export interface UpgradeAuthentication {
  clientSecret: string;
}

export interface ChangePlanResult {
  changed: boolean;
  scheduled: boolean;
  planId: string;
  effectiveAt: Date | null;
  checkoutUrl: string | null;
  /** Set when the upgrade waits on a 3D Secure challenge. */
  authentication: UpgradeAuthentication | null;
}

/** A plan of the comparison, with what the owner needs to choose it. */
export interface OfferedPlanView extends TenantPlanView {
  description: string;
  billingMode: Plan["billingMode"];
  /** Seat cap of the plan; negative (-1) for no cap. */
  maxMembers: number;
  trialDays: number;
  /**
   * Whether choosing the plan now starts its trial: only a first paid
   * subscription opened through Checkout does, for an owner who never had one.
   */
  isTrialOffered: boolean;
}

/** Seats the workspace holds: members and pending invitations each take one. */
export interface SeatsInUse {
  members: number;
  pendingInvites: number;
  occupied: number;
}

export interface CurrentPlanResult {
  current: Plan | null;
  seats: SeatsInUse;
  available: OfferedPlanView[];
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
  authentication: null,
} as const;

/**
 * The plan exists, is on sale and is billed on a Stripe price that matches
 * it: what any path that selects a plan, or prices one, starts from.
 */
export async function loadSellablePlan(
  planModel: PlanModel,
  planId: string,
): Promise<Plan> {
  const storedPlan = await planModel.get(planId);
  assert(
    storedPlan && !storedPlan.isDeleted && storedPlan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.invalid",
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

/** A plan reserved to one customer type is not sold to the other. */
export function assertPlanAudience(
  plan: Plan,
  customerType: string | null | undefined,
): void {
  assert(
    customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.customer_type_unknown",
  );
  assert(
    plan.audience === "any" || plan.audience === customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
}

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
  assertPlanAudience(storedPlan, customerType);
  return loadSellablePlan(planModel, planId);
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

/** Points the workspace at the plan Stripe now bills, under the admitted intent. */
export async function recordPlanChange(
  subscription: TenantSubscription,
  newPlan: Plan,
  operationId: string,
  tenantSubscriptionModel: TenantSubscriptionModel,
): Promise<void> {
  await tenantSubscriptionModel.updateDuringTransition(
    subscription._id,
    operationId,
    {
      planId: newPlan._id,
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

/**
 * What the subscription item is billed for on the new plan: a seat plan
 * bills the occupied seats, a flat plan one unit — set with the price, or a
 * move from a seat plan would keep billing the flat price once per seat.
 */
export async function planQuantity(
  tenantId: string,
  plan: Plan,
): Promise<number> {
  if (plan.billingMode !== SEAT_BILLING_MODE) return FLAT_QUANTITY;
  return countOccupiedSeats(tenantId);
}

/**
 * A pending update accepts no `automatic_tax`; the subscription has carried
 * it since it was created, so only the deferred path restates it.
 */
function toChargeParams(
  billing: ImmediateChangeBilling,
): Stripe.SubscriptionUpdateParams {
  if (billing.prorationBehavior !== "always_invoice") {
    return {
      proration_behavior: billing.prorationBehavior,
      automatic_tax: { enabled: true },
    };
  }
  return {
    proration_behavior: billing.prorationBehavior,
    proration_date: billing.prorationDate,
    payment_behavior: PAID_UPGRADE_PAYMENT_BEHAVIOR,
  };
}

async function syncStripePlanChange(
  change: StripePlanChange,
): Promise<Stripe.Subscription | null> {
  const { subscription, newPlan, operationId, billing } = change;
  if (!subscription.stripeSubscriptionId) return null;
  const stripePriceId = newPlan.paymentProviderRefs?.stripePriceId;
  assert(stripePriceId, HTTP_BAD_REQUEST, "saas.errors.plan.no_stripe_price");
  const stripe = getStripeClient();
  const stripeSubscription = await stripe.subscriptions.retrieve(
    subscription.stripeSubscriptionId,
  );
  const itemId = stripeSubscription.items.data[0]?.id;
  assert(itemId, HTTP_BAD_REQUEST, "saas.errors.stripe.subscription_no_item");
  const quantity = await planQuantity(subscription._id, newPlan);
  return stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    {
      items: [{ id: itemId, price: stripePriceId, quantity }],
      ...toChargeParams(billing),
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

/** A paid target without a live Stripe subscription goes through Checkout. */
export function startsPaidCheckout(
  newPlan: Plan,
  subscription: TenantSubscription | undefined,
): boolean {
  return isPaidPlan(newPlan) && !subscription?.stripeSubscriptionId;
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

/** Where an immediate change is admitted and recorded. */
interface ImmediateChangeAdmission {
  tenantId: string;
  intent: SubscriptionTransition;
  model: TenantSubscriptionModel;
}

export function newChangeIntent(newPlan: Plan): SubscriptionTransition {
  return {
    operationId: randomUUID(),
    kind: "change_plan",
    targetPlanId: newPlan._id,
    requestedAt: new Date(),
  };
}

/**
 * Returns the updated Stripe subscription. One still carrying a
 * `pending_update` has not moved: its invoice awaits payment, so the
 * workspace keeps its plan until that payment lands.
 */
async function runImmediateChange(
  change: StripePlanChange,
  admission: ImmediateChangeAdmission,
): Promise<Stripe.Subscription | null> {
  const { tenantId, intent, model } = admission;
  await model.beginTransition(change.subscription, intent);
  await clearPendingPlanChange(
    tenantId,
    change.subscription,
    intent.operationId,
  );
  const updated = await syncStripePlanChange(change);
  if (updated?.pending_update) return updated;
  await recordPlanChange(
    change.subscription,
    change.newPlan,
    intent.operationId,
    model,
  );
  await finalizeImmediateChange(tenantId, change.subscription, change.newPlan);
  return updated;
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
  const intent = operatorIntent ?? newChangeIntent(newPlan);
  const change: StripePlanChange = {
    subscription,
    newPlan,
    operationId: intent.operationId,
    billing: DEFERRED_PRORATION_BILLING,
  };
  await runImmediateChange(change, {
    tenantId,
    intent,
    model: tenantSubscriptionModel,
  });
  if (!operatorIntent)
    await tenantSubscriptionModel.completeTransition(
      subscription._id,
      intent.operationId,
      {},
    );
  return { ...UNCHANGED_RESULT_BASE, changed: true, planId: newPlan._id };
}

/**
 * Stripe refused the whole update because the card was declined: nothing
 * changed on its side, so the admission is released and the owner told.
 */
async function releaseDeclinedUpgrade(
  error: unknown,
  admission: ImmediateChangeAdmission,
  subscriptionId: string,
): Promise<never> {
  if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
  await admission.model.completeTransition(
    subscriptionId,
    admission.intent.operationId,
    {},
  );
  throw new HTTPResult(
    HTTP_PAYMENT_REQUIRED,
    "saas.errors.plan.upgrade_payment_declined",
  );
}

/**
 * The challenge of an upgrade Stripe left pending. Anything but a payment
 * waiting on authentication is a declined card: the update is dropped, so the
 * plan stays as it was and no unpaid invoice lingers.
 */
async function requestUpgradeAuthentication(
  stripeSubscription: Stripe.Subscription,
): Promise<UpgradeAuthentication> {
  const clientSecret = await readPendingChallengeSecret(stripeSubscription);
  if (clientSecret) return { clientSecret };
  await discardPendingUpdate(stripeSubscription);
  throw new HTTPResult(
    HTTP_PAYMENT_REQUIRED,
    "saas.errors.plan.upgrade_payment_declined",
  );
}

/**
 * The owner's own upgrade: the prorated difference is charged at once on the
 * card on file, at the date the reviewed preview was priced, and a declined
 * card leaves the plan as it was. A card that asks for 3D Secure returns the
 * challenge instead; the plan applies once the owner passes it.
 */
export async function applyOwnerUpgrade(
  tenantId: string,
  subscription: TenantSubscription,
  newPlan: Plan,
  tenantSubscriptionModel: TenantSubscriptionModel,
  prorationDate: number | undefined,
): Promise<ChangePlanResult> {
  const intent = newChangeIntent(newPlan);
  const admission = { tenantId, intent, model: tenantSubscriptionModel };
  const change: StripePlanChange = {
    subscription,
    newPlan,
    operationId: intent.operationId,
    billing: { prorationBehavior: "always_invoice", prorationDate },
  };
  const updated = await runImmediateChange(change, admission).catch(
    (error: unknown) =>
      releaseDeclinedUpgrade(error, admission, subscription._id),
  );
  await tenantSubscriptionModel.completeTransition(
    subscription._id,
    intent.operationId,
    {},
  );
  if (updated?.pending_update) {
    return {
      ...UNCHANGED_RESULT_BASE,
      planId: newPlan._id,
      authentication: await requestUpgradeAuthentication(updated),
    };
  }
  return { ...UNCHANGED_RESULT_BASE, changed: true, planId: newPlan._id };
}
