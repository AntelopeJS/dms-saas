// The owner cancelling the subscription at the end of its cycle, and changing
// their mind before it ends. Stripe holds the cancellation itself
// (`cancel_at_period_end`); its `customer.subscription.deleted` webhook moves
// the workspace to `cancelled` when the cycle runs out.

import { randomUUID } from "node:crypto";
import {
  Context,
  Controller,
  Delete,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { recomputeTenantBillingState } from "../../billing-state";
import {
  type SubscriptionTransition,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { clearPendingPlanChange } from "../../plan-changes";
import { setSubscriptionCancelAtPeriodEnd } from "../../stripe/plan-schedule";
import { isComplimentarySubscription } from "../../workspaces/complimentary";
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  PAST_DUE_STATUS,
} from "./tenant-plan-ops";

const CANCEL_KIND = "cancel" as const;

/** When the subscription ends, or null once it renews again. */
export interface CancellationResult {
  cancelAt: Date | null;
}

/** A subscription billed through Stripe, which carries the cancellation. */
type StripeBilledSubscription = TenantSubscription & {
  stripeSubscriptionId: string;
};

/** A paid subscription on Stripe, not a gift. */
export function assertStripeBilled(
  subscription: TenantSubscription | undefined,
): asserts subscription is StripeBilledSubscription {
  assert(
    subscription?.stripeSubscriptionId &&
      !isComplimentarySubscription(subscription),
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.no_active_subscription",
  );
}

/**
 * Like a downgrade, cancelling waits for an unpaid invoice to be settled, or
 * the workspace would walk away from it at cycle end.
 */
export function assertNothingUnpaid(subscription: TenantSubscription): void {
  assert(
    subscription.status !== PAST_DUE_STATUS,
    HTTP_CONFLICT,
    "saas.errors.plan.unpaid_invoice_blocks_cancellation",
  );
}

function cancelIntent(): SubscriptionTransition {
  return {
    operationId: randomUUID(),
    kind: CANCEL_KIND,
    targetPlanId: null,
    requestedAt: new Date(),
  };
}

/**
 * Sets or lifts the cycle-end cancellation under an admitted intent. A parked
 * downgrade goes first: Stripe cannot hold both, and leaving is the owner's
 * last word.
 */
async function writeCancellation(
  tenantId: string,
  subscription: StripeBilledSubscription,
  model: TenantSubscriptionModel,
  shouldCancel: boolean,
): Promise<CancellationResult> {
  const intent = cancelIntent();
  await model.beginTransition(subscription, intent);
  await clearPendingPlanChange(tenantId, subscription, intent.operationId);
  const periodEnd = await setSubscriptionCancelAtPeriodEnd(
    subscription.stripeSubscriptionId,
    shouldCancel,
  );
  await model.completeTransition(subscription._id, intent.operationId, {
    updatedAt: new Date(),
  });
  await recomputeTenantBillingState(tenantId);
  return { cancelAt: shouldCancel ? periodEnd : null };
}

export class SaasTenantPlanCancellationController extends Controller(
  "/api/saas/tenant/plan/cancellation",
) {
  /** Ends the subscription when the cycle already paid for runs out. */
  @Post("/")
  async cancelAtPeriodEnd(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<CancellationResult> {
    const subscription = await tenantSubscriptionModel.findOne();
    assertStripeBilled(subscription);
    assertNothingUnpaid(subscription);
    return writeCancellation(
      getRequestTenantId(ctx),
      subscription,
      tenantSubscriptionModel,
      true,
    );
  }

  /** Keeps the subscription renewing after a cancellation was scheduled. */
  @Delete("/")
  async keepSubscription(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<CancellationResult> {
    const subscription = await tenantSubscriptionModel.findOne();
    assertStripeBilled(subscription);
    return writeCancellation(
      getRequestTenantId(ctx),
      subscription,
      tenantSubscriptionModel,
      false,
    );
  }
}
