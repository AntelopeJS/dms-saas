import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import {
  type Plan,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { asCustomerId, findTenantByCustomerId } from "../stripe/webhook-shared";
import {
  finalizeImmediateChange,
  newChangeIntent,
  recordPlanChange,
} from "./immediate";

/** The price Stripe bills a subscription on. */
export function billedPriceId(
  stripeSubscription: Stripe.Subscription,
): string | null {
  return stripeSubscription.items.data[0]?.price?.id ?? null;
}

/**
 * Records the plan Stripe applied once an owner's upgrade invoice was paid,
 * from the confirm call after the 3D Secure challenge or from the
 * `customer.subscription.pending_update_applied` webhook, whichever lands first.
 */
async function recordAppliedUpgrade(
  tenantId: string,
  subscription: TenantSubscription,
  plan: Plan,
  model: TenantSubscriptionModel,
): Promise<void> {
  const intent = newChangeIntent(plan);
  await model.beginTransition(subscription, intent);
  await recordPlanChange(subscription, plan, intent.operationId, model);
  await finalizeImmediateChange(tenantId, subscription, plan);
  await model.completeTransition(subscription._id, intent.operationId, {});
}

/** The confirm call and the webhook may race; the loser finds the plan set. */
export async function recordUnlessAlreadyApplied(
  tenantId: string,
  subscription: TenantSubscription,
  plan: Plan,
  model: TenantSubscriptionModel,
): Promise<void> {
  await recordAppliedUpgrade(tenantId, subscription, plan, model).catch(
    async (error: unknown) => {
      const current = await model.findOne();
      if (current?.planId !== plan._id) throw error;
    },
  );
}

async function findPlanByPrice(priceId: string | null): Promise<Plan | null> {
  if (!priceId) return null;
  const plans = await GetModel(PlanModel).findNotDeleted();
  return (
    plans.find((plan) => plan.paymentProviderRefs?.stripePriceId === priceId) ??
    null
  );
}

/** Stripe applied a paid upgrade the confirm call may never have reported. */
export async function handleSubscriptionPendingUpdateApplied(
  event: Stripe.Event,
): Promise<void> {
  const stripeSubscription = event.data.object as Stripe.Subscription;
  const customerId = asCustomerId(stripeSubscription.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  const model = GetModel(TenantSubscriptionModel, tenant._id);
  const subscription = await model.findOne();
  if (subscription?.stripeSubscriptionId !== stripeSubscription.id) return;
  const plan = await findPlanByPrice(billedPriceId(stripeSubscription));
  if (!plan || plan._id === subscription.planId) return;
  await recordUnlessAlreadyApplied(tenant._id, subscription, plan, model);
}
