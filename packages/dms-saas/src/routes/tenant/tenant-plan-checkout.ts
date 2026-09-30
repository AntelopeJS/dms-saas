// Starting a paid plan through Stripe Checkout, split out of tenant-plan-ops.ts
// to keep both files under the size the linter allows.
//
// The checkout intent is admitted as a subscription transition before any
// Stripe call, and only the completion or expiry webhook of the session it
// recorded may clear it. Two paths clear it earlier, both only once Stripe
// provably holds no session a customer could pay: a failure Stripe itself
// refused, and an admission whose request never recorded its session.

import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import type Stripe from "stripe";
import { recomputeTenantBillingState } from "../../billing-state";
import { isAllowedRedirectUrl } from "../../config";
import {
  type SubscriptionTransition,
  type TenantSubscription,
  type TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../../db";
import { getStripeClient } from "../../stripe/client";
import {
  createTenantCheckoutCustomer,
  createWorkspaceCheckoutSession,
  deleteStripeCustomerIfExists,
  isDefinitiveStripeRejection,
  UnusableCheckoutSessionError,
  type WorkspaceCheckoutSession,
} from "../../stripe/workspace-checkout";
import { hashEmail } from "../../utils";
import { isComplimentarySubscription } from "../../workspaces/complimentary";
import {
  TrialIdentityModel,
  trialIdentityId,
} from "../../workspaces/db/trial-identity.model";
import {
  type ChangePlanBody,
  type ChangePlanResult,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  type PlanChangeRequest,
  UNCHANGED_RESULT_BASE,
} from "./tenant-plan-ops";

const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVICE_UNAVAILABLE = 503;
const PENDING_PAYMENT_STATUS = "pending_payment" as const;
const PLACEHOLDER_PLAN_ID: string | null = null;
const CHECKOUT_KIND = "checkout" as const;
const EXPIRED_SESSION_STATUS = "expired";
const MS_PER_MINUTE = 60_000;
const LOG_PREFIX = "[dms-saas:checkout]";

/**
 * How long an admitted checkout may go without recording its session before
 * it counts as abandoned. It outlasts any live request — Stripe's own client
 * timeout and retries included — so a request still on its way to record its
 * session is never mistaken for a dead one.
 */
export const UNRECORDED_CHECKOUT_TTL_MS = 15 * MS_PER_MINUTE;

interface CheckoutRedirectInput {
  successUrl: string;
  cancelUrl: string;
}

/** What one checkout attempt created before Stripe answered. */
interface CheckoutAttempt {
  operationId: string;
  tenantId: string;
  subscriptionId: string;
  createdCustomerId: string | null;
  reservedTrialIdentityId: string | null;
}

interface TrialGrant {
  days: number;
  reservedIdentityId: string | null;
}

interface AdmittedCheckout extends CheckoutAttempt {
  subscription: TenantSubscription;
}

/** Everything a checkout session is opened with, besides the attempt itself. */
interface CheckoutSessionTarget {
  stripePriceId: string;
  existingCustomerId: string | null;
  redirect: CheckoutRedirectInput;
}

const NO_TRIAL: TrialGrant = { days: 0, reservedIdentityId: null };

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function validateCheckoutRedirectInput(
  body: ChangePlanBody,
): CheckoutRedirectInput {
  const successUrl = asNonEmptyString(body.successUrl);
  const cancelUrl = asNonEmptyString(body.cancelUrl);
  assert(
    successUrl && isAllowedRedirectUrl(successUrl),
    HTTP_BAD_REQUEST,
    "saas.errors.billing.invalid_return_url",
  );
  assert(
    cancelUrl && isAllowedRedirectUrl(cancelUrl),
    HTTP_BAD_REQUEST,
    "saas.errors.billing.invalid_return_url",
  );
  return { successUrl, cancelUrl };
}

async function resolveCheckoutTrial(
  request: PlanChangeRequest,
): Promise<TrialGrant> {
  const { newPlan, user, tenantId } = request;
  if (!newPlan.trialDays || newPlan.trialDays <= 0) return NO_TRIAL;
  const trialConsumptionModel = GetModel(TrialConsumptionModel);
  const emailHash = hashEmail(user.email);
  if (await trialConsumptionModel.existsForIdentity(emailHash, null)) {
    return NO_TRIAL;
  }
  const identities = GetModel(TrialIdentityModel);
  const id = trialIdentityId("email", emailHash);
  if ((await identities.get(id))?.tenantId) return NO_TRIAL;
  if (!(await identities.reserve(id, tenantId))) return NO_TRIAL;
  return { days: newPlan.trialDays, reservedIdentityId: id };
}

async function initializeCheckoutSubscription(
  request: PlanChangeRequest,
): Promise<TenantSubscription> {
  if (request.subscription) return request.subscription;
  await request.tenantSubscriptionModel.insert({
    _id: request.tenantId,
    planId: PLACEHOLDER_PLAN_ID,
    status: PENDING_PAYMENT_STATUS,
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    createdBy: request.user._id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const subscription = await request.tenantSubscriptionModel.get(
    request.tenantId,
  );
  if (!subscription)
    throw new Error(
      "Checkout subscription acknowledgement requires reconciliation",
    );
  return subscription;
}

async function retrieveRecordedSession(
  subscription: TenantSubscription,
  transition: SubscriptionTransition,
): Promise<Stripe.Checkout.Session | null> {
  if (!subscription.stripeCheckoutSessionId) return null;
  const session = await getStripeClient().checkout.sessions.retrieve(
    subscription.stripeCheckoutSessionId,
  );
  // A session id left over from an earlier, completed checkout is not this
  // admission's session.
  return session.metadata?.operationId === transition.operationId
    ? session
    : null;
}

function isUnrecordedPastTtl(
  transition: SubscriptionTransition,
  now: Date,
): boolean {
  const age = now.getTime() - new Date(transition.requestedAt).getTime();
  return age >= UNRECORDED_CHECKOUT_TTL_MS;
}

/**
 * Whether a pending checkout admission can no longer lead to a payment. Its
 * session either expired — the webhook that would have said so may have been
 * lost — or was never recorded: the redirect URL only reaches the customer
 * once the session is recorded, so an unrecorded session is one nobody can
 * pay. The TTL keeps a request that is still recording from being overtaken.
 */
async function isAbandonedCheckout(
  subscription: TenantSubscription,
  transition: SubscriptionTransition,
  now: Date,
): Promise<boolean> {
  const session = await retrieveRecordedSession(subscription, transition);
  if (session) return session.status === EXPIRED_SESSION_STATUS;
  return isUnrecordedPastTtl(transition, now);
}

/**
 * Clears a checkout admission that can no longer complete, so the owner's
 * next attempt reconciles it instead of failing on it. The revision check of
 * the write fences any webhook racing this release.
 */
export async function releaseAbandonedCheckout(
  subscription: TenantSubscription,
  model: TenantSubscriptionModel,
  now = new Date(),
): Promise<TenantSubscription> {
  const transition = subscription.domainTransition;
  if (transition?.kind !== CHECKOUT_KIND) return subscription;
  if (!(await isAbandonedCheckout(subscription, transition, now))) {
    return subscription;
  }
  Logging.Warn(
    `${LOG_PREFIX} releasing abandoned checkout ${transition.operationId} of tenant ${subscription._id}`,
  );
  const outcome = await model.mutateRevision(subscription, {
    domainTransition: null,
    stripeCheckoutSessionId: null,
  });
  if (outcome !== "applied")
    throw new Error(`Checkout release ${outcome}; reload before retry`);
  const released = await model.get(subscription._id);
  if (!released) throw new Error("Subscription vanished during release");
  return released;
}

async function attachCheckoutSession(
  checkout: WorkspaceCheckoutSession,
  subscription: TenantSubscription,
  model: TenantSubscriptionModel,
  operationId: string,
): Promise<void> {
  await model.updateDuringTransition(subscription._id, operationId, {
    isComplimentary: isComplimentarySubscription(subscription),
    stripeCustomerId: checkout.customerId,
    stripeCheckoutSessionId: checkout.sessionId,
    updatedAt: new Date(),
  });
}

async function expireUnusableSession(error: unknown): Promise<void> {
  if (!(error instanceof UnusableCheckoutSessionError)) return;
  await getStripeClient().checkout.sessions.expire(error.sessionId);
}

/**
 * Undoes one attempt once Stripe provably holds nothing payable: the
 * admission, the trial it reserved and the customer it created all go, so the
 * owner can simply try again. Cleanup of the customer is best effort — an
 * unused customer bills nobody.
 */
async function rollbackCheckoutAttempt(
  attempt: CheckoutAttempt,
  model: TenantSubscriptionModel,
): Promise<void> {
  await model.completeTransition(
    attempt.subscriptionId,
    attempt.operationId,
    {},
  );
  if (attempt.reservedTrialIdentityId) {
    await GetModel(TrialIdentityModel)
      .releaseUnused(attempt.reservedTrialIdentityId, attempt.tenantId)
      .catch((releaseError) =>
        Logging.Warn(
          `${LOG_PREFIX} failed to release the trial reserved by checkout ${attempt.operationId}`,
          releaseError,
        ),
      );
  }
  if (attempt.createdCustomerId) {
    await deleteStripeCustomerIfExists(attempt.createdCustomerId).catch(
      (cleanupError) =>
        Logging.Warn(
          `${LOG_PREFIX} failed to delete unused Stripe customer ${attempt.createdCustomerId}`,
          cleanupError,
        ),
    );
  }
}

/**
 * A refusal Stripe stated is rolled back and reported as such. Anything else
 * leaves the admission in place — a session may exist — for the TTL release
 * to reclaim once no request can still record it.
 */
async function failCheckoutAttempt(
  error: unknown,
  attempt: CheckoutAttempt,
  model: TenantSubscriptionModel,
): Promise<never> {
  Logging.Error(
    `${LOG_PREFIX} Stripe Checkout failed for tenant ${attempt.tenantId}`,
    error,
  );
  const isUnusableSession = error instanceof UnusableCheckoutSessionError;
  if (!isDefinitiveStripeRejection(error) && !isUnusableSession) {
    throw new HTTPResult(
      HTTP_SERVICE_UNAVAILABLE,
      "saas.errors.billing.checkout_unavailable",
    );
  }
  await expireUnusableSession(error);
  await rollbackCheckoutAttempt(attempt, model);
  throw new HTTPResult(
    HTTP_UNPROCESSABLE,
    "saas.errors.billing.checkout_rejected",
  );
}

async function admitCheckout(
  request: PlanChangeRequest,
): Promise<AdmittedCheckout> {
  const model = request.tenantSubscriptionModel;
  const subscription = await releaseAbandonedCheckout(
    await initializeCheckoutSubscription(request),
    model,
  );
  assert(
    !subscription.domainTransition,
    HTTP_CONFLICT,
    subscription.domainTransition?.kind === CHECKOUT_KIND
      ? "saas.errors.plan.checkout_in_progress"
      : "saas.errors.plan.change_in_progress",
  );
  const operationId = randomUUID();
  await model.beginTransition(subscription, {
    operationId,
    kind: CHECKOUT_KIND,
    targetPlanId: request.newPlan._id,
    requestedAt: new Date(),
  });
  return {
    subscription,
    operationId,
    tenantId: request.tenantId,
    subscriptionId: subscription._id,
    createdCustomerId: null,
    reservedTrialIdentityId: null,
  };
}

async function openCheckoutSession(
  request: PlanChangeRequest,
  attempt: CheckoutAttempt,
  target: CheckoutSessionTarget,
): Promise<WorkspaceCheckoutSession> {
  const { existingCustomerId, redirect } = target;
  const trial = await resolveCheckoutTrial(request);
  attempt.reservedTrialIdentityId = trial.reservedIdentityId;
  // Created here rather than inside the session call so a refused session
  // leaves no customer behind that nothing points to.
  const customerId =
    existingCustomerId ??
    (await createTenantCheckoutCustomer({
      operationId: attempt.operationId,
      tenantId: request.tenantId,
      ownerEmail: request.user.email,
    }));
  if (!existingCustomerId) attempt.createdCustomerId = customerId;
  return createWorkspaceCheckoutSession({
    operationId: attempt.operationId,
    tenantId: request.tenantId,
    ownerEmail: request.user.email,
    stripePriceId: target.stripePriceId,
    trialDays: trial.days,
    successUrl: redirect.successUrl,
    cancelUrl: redirect.cancelUrl,
    planId: request.newPlan._id,
    existingCustomerId: customerId,
  });
}

async function createAdmittedCheckout(
  request: PlanChangeRequest,
): Promise<ChangePlanResult> {
  const { tenantId, newPlan, body, tenantSubscriptionModel } = request;
  const redirect = validateCheckoutRedirectInput(body);
  const stripePriceId = newPlan.paymentProviderRefs?.stripePriceId;
  assert(stripePriceId, HTTP_BAD_REQUEST, "saas.errors.plan.no_stripe_price");
  const { subscription, ...attempt } = await admitCheckout(request);
  const checkout = await openCheckoutSession(request, attempt, {
    stripePriceId,
    existingCustomerId: subscription.stripeCustomerId ?? null,
    redirect,
  }).catch((error: unknown) =>
    failCheckoutAttempt(error, attempt, tenantSubscriptionModel),
  );
  await attachCheckoutSession(
    checkout,
    subscription,
    tenantSubscriptionModel,
    attempt.operationId,
  );
  await recomputeTenantBillingState(tenantId);
  return {
    ...UNCHANGED_RESULT_BASE,
    planId: newPlan._id,
    checkoutUrl: checkout.url,
  };
}

/** Admit checkout before provider effects and retain intent until terminal session evidence. */
export async function startPaidCheckout(
  request: PlanChangeRequest,
): Promise<ChangePlanResult> {
  return runTenantLifecycleOperation(request.tenantId, () =>
    createAdmittedCheckout(request),
  );
}
