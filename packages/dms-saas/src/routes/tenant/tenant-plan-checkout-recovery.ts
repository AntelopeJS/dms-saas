// Getting a workspace out of a checkout its owner walked away from, split out
// of tenant-plan-checkout.ts to keep both files under the size the linter
// allows.
//
// A checkout admission is only ever released once Stripe provably holds no
// session a customer could still pay: the recorded session expired — on its
// own, or because this module expired it — or no session was ever recorded.
// A completed session is never released: its payment is on its way to the
// completion webhook.

import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import Stripe from "stripe";
import type {
  SubscriptionTransition,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { getStripeClient } from "../../stripe/client";
import { releaseCheckoutTrialReservation } from "../../stripe/workspace-checkout";
import { HTTP_CONFLICT } from "./tenant-plan-ops";

const CHECKOUT_KIND = "checkout" as const;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
const LOG_PREFIX = "[dms-saas:checkout]";
const CHECKOUT_IN_PROGRESS_KEY = "saas.errors.plan.checkout_in_progress";
const CHECKOUT_ALREADY_PAID_KEY = "saas.errors.plan.checkout_already_paid";

/**
 * How long an admitted checkout may go without recording its session before
 * it counts as abandoned. It outlasts any live request — Stripe's own client
 * timeout and retries included — so a request still on its way to record its
 * session is never mistaken for a dead one.
 */
export const UNRECORDED_CHECKOUT_TTL_MS = 15 * MS_PER_MINUTE;

/**
 * Query parameters Stripe Checkout's cancel URL carries back to the billing
 * page, so the page can release the checkout its owner just walked out of.
 * The operation id, rather than the session id, ties the return to one
 * admission: it is known before the session exists, and a stale cancel link
 * of an earlier checkout can never release a newer one.
 */
export const CHECKOUT_CANCELLED_PARAM = "checkout";
export const CHECKOUT_CANCELLED_VALUE = "cancelled";
export const CHECKOUT_OPERATION_PARAM = "checkoutOperation";

/** The checkout a workspace is waiting on, as the owner's billing page sees it. */
export interface PendingCheckout {
  targetPlanId: string | null;
  /** Where the owner can resume paying; null once nothing is left to pay. */
  checkoutUrl: string | null;
  expiresAt: Date | null;
  /** Paid, and waiting for Stripe's completion webhook to apply the plan. */
  isPaid: boolean;
}

export interface PendingCheckoutResult {
  pending: PendingCheckout | null;
}

export interface CancelCheckoutResult {
  released: boolean;
}

interface CheckoutAbandonment {
  isAbandoned: boolean;
  session: Stripe.Checkout.Session | null;
}

type SessionStatus = NonNullable<Stripe.Checkout.Session["status"]>;

/** Appends the cancellation marker to the URL Stripe sends a quitting owner to. */
export function withCheckoutCancelMarker(
  cancelUrl: string,
  operationId: string,
): string {
  const url = new URL(cancelUrl);
  url.searchParams.set(CHECKOUT_CANCELLED_PARAM, CHECKOUT_CANCELLED_VALUE);
  url.searchParams.set(CHECKOUT_OPERATION_PARAM, operationId);
  return url.toString();
}

function pendingCheckoutTransition(
  subscription: TenantSubscription | undefined,
): SubscriptionTransition | null {
  const transition = subscription?.domainTransition;
  return transition?.kind === CHECKOUT_KIND ? transition : null;
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
 * Clears the admission, fenced by its revision. Losing that race to the
 * expiry webhook, which releases the same admission, is still a release;
 * losing it to anything else is not ours to settle.
 */
async function releaseCheckoutTransition(
  subscription: TenantSubscription,
  model: TenantSubscriptionModel,
  session: Stripe.Checkout.Session | null,
): Promise<TenantSubscription> {
  const operationId = subscription.domainTransition?.operationId;
  Logging.Warn(
    `${LOG_PREFIX} releasing abandoned checkout ${operationId} of tenant ${subscription._id}`,
  );
  const outcome = await model.mutateRevision(subscription, {
    domainTransition: null,
    stripeCheckoutSessionId: null,
  });
  const released = await model.get(subscription._id);
  if (!released) throw new Error("Subscription vanished during release");
  const isStillPending = released.domainTransition?.operationId === operationId;
  if (outcome !== "applied" && isStillPending)
    throw new Error(`Checkout release ${outcome}; reload before retry`);
  if (session) await releaseCheckoutTrialReservation(session, released._id);
  return released;
}

/**
 * Whether a pending checkout admission can no longer lead to a payment, and
 * the session that proves it. Its session either expired — the webhook that
 * would have said so may have been lost — or was never recorded: the
 * redirect URL only reaches the customer once the session is recorded, so an
 * unrecorded session is one nobody can pay. The TTL keeps a request that is
 * still recording from being overtaken.
 */
async function findAbandonment(
  subscription: TenantSubscription,
  transition: SubscriptionTransition,
  now: Date,
): Promise<CheckoutAbandonment> {
  const session = await retrieveRecordedSession(subscription, transition);
  if (session) return { isAbandoned: session.status === "expired", session };
  return { isAbandoned: isUnrecordedPastTtl(transition, now), session };
}

/**
 * Clears a checkout admission that can no longer complete, so the owner's
 * next attempt reconciles it instead of failing on it.
 */
export async function releaseAbandonedCheckout(
  subscription: TenantSubscription,
  model: TenantSubscriptionModel,
  now = new Date(),
): Promise<TenantSubscription> {
  const transition = pendingCheckoutTransition(subscription);
  if (!transition) return subscription;
  const { isAbandoned, session } = await findAbandonment(
    subscription,
    transition,
    now,
  );
  if (!isAbandoned) return subscription;
  return releaseCheckoutTransition(subscription, model, session);
}

function describeSession(
  transition: SubscriptionTransition,
  session: Stripe.Checkout.Session | null,
): PendingCheckout | null {
  if (session?.status === "expired") return null;
  const isOpen = session?.status === "open";
  return {
    targetPlanId: transition.targetPlanId,
    checkoutUrl: isOpen ? (session.url ?? null) : null,
    expiresAt:
      isOpen && session.expires_at
        ? new Date(session.expires_at * MS_PER_SECOND)
        : null,
    isPaid: session?.status === "complete",
  };
}

/** What the owner can do about the checkout the workspace is waiting on. */
export async function describePendingCheckout(
  subscription: TenantSubscription | undefined,
): Promise<PendingCheckoutResult> {
  const transition = pendingCheckoutTransition(subscription);
  if (!subscription || !transition) return { pending: null };
  const session = await retrieveRecordedSession(subscription, transition);
  return { pending: describeSession(transition, session) };
}

/**
 * Expires a session Stripe still holds open, then reads back what it became:
 * a customer may have completed it a moment before, which Stripe reports by
 * refusing the expiry.
 */
async function expireOpenSession(
  session: Stripe.Checkout.Session,
): Promise<Stripe.Checkout.Session> {
  if (session.status !== "open") return session;
  const sessions = getStripeClient().checkout.sessions;
  try {
    return await sessions.expire(session.id);
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError))
      throw error;
    return sessions.retrieve(session.id);
  }
}

const CANCELLATION_REFUSALS: Partial<Record<SessionStatus, string>> = {
  open: CHECKOUT_IN_PROGRESS_KEY,
  complete: CHECKOUT_ALREADY_PAID_KEY,
};

async function cancelRecordedSession(
  subscription: TenantSubscription,
  model: TenantSubscriptionModel,
  session: Stripe.Checkout.Session,
): Promise<CancelCheckoutResult> {
  const settled = await expireOpenSession(session);
  const refusal = settled.status && CANCELLATION_REFUSALS[settled.status];
  if (refusal) throw new HTTPResult(HTTP_CONFLICT, refusal);
  await releaseCheckoutTransition(subscription, model, settled);
  return { released: true };
}

/**
 * The owner giving up on a pending checkout — from the billing page, or by
 * leaving Stripe through its cancel link. The session is expired first, so
 * the link the owner may still hold can no longer take a payment, then the
 * admission is released. `operationId`, when given, must name the pending
 * admission: a stale cancel link releases nothing.
 */
export async function cancelPendingCheckout(
  subscription: TenantSubscription | undefined,
  model: TenantSubscriptionModel,
  operationId: string | null,
  now = new Date(),
): Promise<CancelCheckoutResult> {
  const transition = pendingCheckoutTransition(subscription);
  if (!subscription || !transition) return { released: false };
  if (operationId && operationId !== transition.operationId)
    return { released: false };
  const session = await retrieveRecordedSession(subscription, transition);
  if (session) return cancelRecordedSession(subscription, model, session);
  if (!isUnrecordedPastTtl(transition, now))
    throw new HTTPResult(HTTP_CONFLICT, CHECKOUT_IN_PROGRESS_KEY);
  await releaseCheckoutTransition(subscription, model, null);
  return { released: true };
}
