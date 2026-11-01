import { setTimeout as delay } from "node:timers/promises";
import {
  Context,
  Controller,
  HTTPResult,
  JSONBody,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type Stripe from "stripe";
import {
  type Plan,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { getStripeClient } from "../../stripe/client";
import {
  discardPendingUpdate,
  isPendingPaymentTaken,
} from "../../stripe/pending-update";
import {
  billedPriceId,
  recordUnlessAlreadyApplied,
} from "../../plan-changes/applied-upgrade";
import {
  type ChangePlanResult,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  loadSellablePlan,
  UNCHANGED_RESULT_BASE,
} from "./tenant-plan-ops";

const HTTP_PAYMENT_REQUIRED = 402;
const SETTLE_POLL_ATTEMPTS = 6;
const SETTLE_POLL_INTERVAL_MS = 500;

export interface ConfirmUpgradeBody {
  planId: string;
}

/**
 * Stripe marks the invoice paid, and applies the update, a moment after the
 * challenge succeeds; the confirm call usually arrives inside that moment. It
 * polls Stripe for up to `SETTLE_POLL_ATTEMPTS` x `SETTLE_POLL_INTERVAL_MS`;
 * past that, the webhook records the change.
 */
async function waitForAppliedUpdate(
  stripeSubscriptionId: string,
): Promise<Stripe.Subscription | null> {
  for (let attempt = 0; attempt < SETTLE_POLL_ATTEMPTS; attempt += 1) {
    await delay(SETTLE_POLL_INTERVAL_MS);
    const current =
      await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
    if (!current.pending_update) return current;
  }
  return null;
}

/**
 * The subscription once its pending update is settled, or null while Stripe
 * still applies a payment it took. A challenge that was not passed drops the
 * update.
 */
async function settlePendingUpgrade(
  stripeSubscription: Stripe.Subscription,
): Promise<Stripe.Subscription | null> {
  if (!stripeSubscription.pending_update) return stripeSubscription;
  if (await isPendingPaymentTaken(stripeSubscription)) {
    return waitForAppliedUpdate(stripeSubscription.id);
  }
  await discardPendingUpdate(stripeSubscription);
  throw new HTTPResult(
    HTTP_PAYMENT_REQUIRED,
    "saas.errors.plan.upgrade_authentication_failed",
  );
}

/**
 * What the owner's browser calls once the 3D Secure challenge is over. It
 * records the plan Stripe now bills, or drops the update when the challenge
 * was not passed. A payment that is taken but not yet applied is left to the
 * webhook, which records it when Stripe does.
 */
export async function confirmOwnerUpgrade(
  tenantId: string,
  subscription: TenantSubscription | undefined,
  plan: Plan,
  model: TenantSubscriptionModel,
): Promise<ChangePlanResult> {
  const applied = { ...UNCHANGED_RESULT_BASE, changed: true, planId: plan._id };
  assert(
    subscription?.stripeSubscriptionId,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.no_active_subscription",
  );
  if (subscription.planId === plan._id) return applied;
  const settled = await settlePendingUpgrade(
    await getStripeClient().subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    ),
  );
  if (!settled) return applied;
  assert(
    billedPriceId(settled) === plan.paymentProviderRefs?.stripePriceId,
    HTTP_CONFLICT,
    "saas.errors.plan.upgrade_not_applied",
  );
  await recordUnlessAlreadyApplied(tenantId, subscription, plan, model);
  return applied;
}

/**
 * The 3D Secure leg of an owner's upgrade. The upgrade is sent to Stripe as a
 * pending update: Stripe applies it only once its invoice is paid. A card that
 * asks for authentication leaves that invoice waiting on the owner, who passes
 * the challenge in the browser; the confirm call then settles the upgrade. The
 * `customer.subscription.pending_update_applied` webhook records it too, for an
 * owner who closes the page between the challenge and the confirm call.
 */
export class SaasTenantPlanAuthenticationController extends Controller(
  "/api/saas/tenant/plan/authentication",
) {
  /** Settles the upgrade once the owner is done with the 3D Secure challenge. */
  @Post("/")
  async confirmUpgrade(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @JSONBody() body: ConfirmUpgradeBody,
    @Context() ctx: RequestContext,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<ChangePlanResult> {
    const plan = await loadSellablePlan(GetModel(PlanModel), body.planId);
    return confirmOwnerUpgrade(
      getRequestTenantId(ctx),
      await tenantSubscriptionModel.findOne(),
      plan,
      tenantSubscriptionModel,
    );
  }
}
