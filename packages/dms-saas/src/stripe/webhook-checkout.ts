// The checkout-session half of the Stripe webhook surface, split out of
// webhook-handlers.ts to keep every file under the size the linter allows.

import { GetModel } from "@antelopejs/interface-database-decorators";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type Stripe from "stripe";
import { emitAutomationEvent } from "../automation";
import { recomputeTenantBillingState } from "../billing-state";
import type {
  SubscriptionTransition,
  TenantSubscription,
  TenantSubscriptionStatus,
} from "../db";
import { TenantSubscriptionModel, TrialConsumptionModel } from "../db";
import { hashEmail, stripeSecondsToDate as optionalStripeDate } from "../utils";
import { activatePaidUsage } from "../workspaces/complimentary";
import { getStripeClient } from "./client";
import { ACTIVE_STATUS, asCustomerId, TRIALING_STATUS } from "./webhook-shared";

async function promoteSubscriptionPaymentMethod(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = asCustomerId(subscription.customer);
  const paymentMethodId =
    typeof subscription.default_payment_method === "string"
      ? subscription.default_payment_method
      : (subscription.default_payment_method?.id ?? null);
  if (!customerId || !paymentMethodId) return;
  const stripe = getStripeClient();
  // A failure propagates on purpose: the whole handler is idempotent, so
  // Stripe's redelivery retries the promotion — swallowing it would leave the
  // card invisible for good on a transient error.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

interface CheckoutContext {
  session: Stripe.Checkout.Session;
  tenantId: string;
  subscriptionId: string;
  targetPlanId: string | null;
}

async function admitCheckoutCompletion(
  context: CheckoutContext,
  existing: TenantSubscription,
): Promise<boolean> {
  if (existing.completedCheckoutSessionId === context.session.id) return false;
  if (existing.stripeCheckoutSessionId !== context.session.id)
    throw new Error("Checkout session is not current");
  if (existing.deletionStartedAt)
    throw new Error("Workspace deletion has started");
  const pending = existing.domainTransition;
  if (
    pending &&
    (pending.kind !== "checkout" ||
      pending.operationId !== context.session.metadata?.operationId ||
      pending.targetPlanId !== context.targetPlanId)
  )
    throw new Error("Checkout completion requires reconciliation");
  const intent = {
    operationId:
      pending?.operationId ?? `checkout-complete:${context.session.id}`,
    kind: "change_plan" as const,
    targetPlanId: context.targetPlanId,
    requestedAt: pending?.requestedAt ?? new Date(),
  };
  const outcome = await GetModel(
    TenantSubscriptionModel,
    context.tenantId,
  ).mutateRevision(existing, { domainTransition: intent });
  if (outcome !== "applied")
    throw new Error(`Checkout completion ${outcome}; reconciliation required`);
  existing.domainTransition = intent;
  return true;
}

function resolveCheckoutContext(event: Stripe.Event): CheckoutContext | null {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "subscription") return null;
  const tenantId =
    typeof session.metadata?.tenantId === "string"
      ? session.metadata.tenantId
      : null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  if (!tenantId || !subscriptionId) return null;
  const targetPlanId =
    typeof session.metadata?.planId === "string"
      ? session.metadata.planId
      : null;
  return { session, tenantId, subscriptionId, targetPlanId };
}

async function mirrorCheckoutSubscription(
  context: CheckoutContext,
  subscription: Stripe.Subscription,
  existing: TenantSubscription,
  status: TenantSubscriptionStatus,
): Promise<void> {
  const patch: Partial<TenantSubscription> = {
    ...activatePaidUsage(
      existing,
      context.subscriptionId,
      optionalStripeDate(subscription.start_date) ?? new Date(),
    ),
    status,
    stripeSubscriptionId: context.subscriptionId,
    // Seed the renewal date immediately: waiting for the first
    // customer.subscription.updated would leave the plan card without its
    // "next renewal" line exactly when the customer just paid.
    currentPeriodEnd: optionalStripeDate(subscription.current_period_end),
    updatedAt: new Date(),
  };
  if (context.targetPlanId) patch.planId = context.targetPlanId;
  const model = GetModel(TenantSubscriptionModel, context.tenantId);
  await model.updateDuringTransition(
    existing._id,
    existing.domainTransition!.operationId,
    patch,
  );
  await recomputeTenantBillingState(context.tenantId);
}

async function completeCheckout(context: CheckoutContext): Promise<void> {
  const existing = await GetModel(
    TenantSubscriptionModel,
    context.tenantId,
  ).findOne();
  const previousTransition = existing?.domainTransition;
  if (!existing || !(await admitCheckoutCompletion(context, existing))) return;
  const subscription = await retrieveActivatedCheckout(
    context,
    existing,
    previousTransition,
  );
  const status: TenantSubscriptionStatus =
    subscription.status === "trialing" ? TRIALING_STATUS : ACTIVE_STATUS;

  await mirrorCheckoutSubscription(context, subscription, existing, status);
  await promoteSubscriptionPaymentMethod(subscription);

  const planId = context.targetPlanId ?? existing.planId;
  const trialConsumptionRecorded =
    subscription.status === "trialing" &&
    (await recordCheckoutTrialConsumption(
      context.session,
      existing.createdBy,
      planId,
    ));

  await GetModel(TenantSubscriptionModel, context.tenantId).completeTransition(
    existing._id,
    existing.domainTransition!.operationId,
    { completedCheckoutSessionId: context.session.id },
  );
  emitAutomationEvent("saas.subscription-started", {
    tenantId: context.tenantId,
    planId,
    status,
    stripeSubscriptionId: context.subscriptionId,
    trialConsumptionRecorded,
    at: new Date().toISOString(),
  });
}

async function retrieveActivatedCheckout(
  context: CheckoutContext,
  existing: TenantSubscription,
  previousTransition: SubscriptionTransition | null | undefined,
): Promise<Stripe.Subscription> {
  const subscription = await getStripeClient().subscriptions.retrieve(
    context.subscriptionId,
  );
  if (
    subscription.status === ACTIVE_STATUS ||
    subscription.status === TRIALING_STATUS
  )
    return subscription;
  // No provider mutation occurred: restore the checkout intent for a later activation callback.
  await GetModel(
    TenantSubscriptionModel,
    context.tenantId,
  ).updateDuringTransition(
    existing._id,
    existing.domainTransition!.operationId,
    { domainTransition: previousTransition ?? null },
  );
  throw new Error("Checkout subscription has not activated");
}

/** Admit one completion executor; uncertain callbacks retain subscription intent. */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const context = resolveCheckoutContext(event);
  if (!context) return;
  await runTenantLifecycleOperation(context.tenantId, () =>
    completeCheckout(context),
  );
}

/** Only an expired, recorded session can relinquish its checkout admission. */
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.metadata?.tenantId;
  if (!tenantId || session.status !== "expired") return;
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const current = await model.findOne();
  if (
    current?.stripeCheckoutSessionId !== session.id ||
    current.domainTransition?.kind !== "checkout"
  )
    return;
  if (current.domainTransition.operationId !== session.metadata?.operationId)
    throw new Error("Checkout expiration identity mismatch");
  const outcome = await model.mutateRevision(current, {
    domainTransition: null,
    stripeCheckoutSessionId: null,
  });
  if (outcome !== "applied")
    throw new Error(`Checkout expiration ${outcome}; reconciliation required`);
}

async function recordCheckoutTrialConsumption(
  session: Stripe.Checkout.Session,
  createdBy: string | null,
  planId: string | null,
): Promise<boolean> {
  const email = session.customer_details?.email;
  if (!email || !createdBy || !planId) return false;
  const emailHash = hashEmail(email);
  const trialConsumptionModel = GetModel(TrialConsumptionModel);
  // Webhooks can be redelivered, and the register flow may already have
  // recorded this identity, so only insert when nothing exists yet.
  if (await trialConsumptionModel.existsForIdentity(emailHash, null)) {
    return true;
  }
  await trialConsumptionModel.insert([
    {
      userId: createdBy,
      emailHash,
      paymentFingerprint: null,
      planId,
      consumedAt: new Date(),
    },
  ]);
  return true;
}
