import type { BillingState } from "../db";
import { type AutomationOriginFields, currentAutomationOrigin } from "./origin";
import { admitOriginatedEvent } from "./loop-guard";

/** Ports every saas trigger carries. */
export type SaasEventBase = AutomationOriginFields & {
  tenantId: string;
  /** Equal on every re-emission of the same event: effects deduplicate on it. */
  deliveryId: string;
  at: string;
};

export type SubscriptionStartedEvent = SaasEventBase & {
  /** Stripe Checkout, or a workspace provisioned with a card on a Stripe-priced plan. */
  source: "checkout" | "provisioning";
  planId: string | null;
  status: "active" | "trialing";
  stripeSubscriptionId: string;
  /**
   * False when the checkout was trialing but the internal trial-consumption
   * row could not be recorded (missing email/creator/plan, or already
   * recorded); workflows must not assume a usage row exists.
   */
  trialConsumptionRecorded: boolean;
};

export type SubscriptionCancelledEvent = SaasEventBase & {
  /** Stripe ended the subscription, or an owner deleted the workspace. */
  source: "stripe" | "workspace_deletion";
  /** Null for a workspace deleted without a Stripe subscription. */
  stripeSubscriptionId: string | null;
};

export type PaymentFailedEvent = SaasEventBase & {
  invoiceId: string;
  invoiceNumber: string | null;
  amountDue: number;
  currency: string;
};

export type TrialEndingEvent = SaasEventBase & {
  trialEndsAt: string | null;
};

/**
 * A workspace's data was deleted. Handed to the armed triggers best-effort:
 * the deletion does not wait for the procedures it starts, and their failures
 * never fail it. A resumed deletion hands it again with the same
 * `deliveryId`, so effects deduplicate on it.
 */
export type TenantDeletedEvent = SaasEventBase & {
  /** The deletion operation, absent when the hook ran without its context. */
  operationId?: string;
};

/**
 * A workspace's billing state moved from one state to another. A suspension a
 * procedure made carries its origin ports.
 */
export type BillingStateChangedEvent = SaasEventBase & {
  fromState: BillingState;
  toState: BillingState;
  planId: string | null;
  planName: string | null;
  mrrMinor: number;
  previousMrrMinor: number;
  currency: string | null;
};

/** A workspace moved to another effective plan. */
export type PlanChangedEvent = SaasEventBase & {
  fromPlanId: string | null;
  toPlanId: string | null;
  fromPlanName: string | null;
  toPlanName: string | null;
  direction: "upgrade" | "downgrade";
  billingState: BillingState;
};

export interface AutomationEventPayloads {
  "saas.subscription-started": SubscriptionStartedEvent;
  "saas.subscription-cancelled": SubscriptionCancelledEvent;
  "saas.payment-failed": PaymentFailedEvent;
  "saas.trial-ending": TrialEndingEvent;
  "saas.tenant-deleted": TenantDeletedEvent;
  "saas.billing-state-changed": BillingStateChangedEvent;
  "saas.plan-changed": PlanChangedEvent;
}

export type AutomationEventName = keyof AutomationEventPayloads;

export type AutomationEventListener<
  E extends AutomationEventName = AutomationEventName,
> = (payload: AutomationEventPayloads[E]) => void | Promise<void>;

type EventListeners = {
  [E in AutomationEventName]: Set<AutomationEventListener<E>>;
};

const eventListeners: EventListeners = {
  "saas.subscription-started": new Set(),
  "saas.subscription-cancelled": new Set(),
  "saas.payment-failed": new Set(),
  "saas.trial-ending": new Set(),
  "saas.tenant-deleted": new Set(),
  "saas.billing-state-changed": new Set(),
  "saas.plan-changed": new Set(),
};

/** The listeners the armed triggers of `event` added. */
export function listenersFor<E extends AutomationEventName>(
  event: E,
): EventListeners[E] {
  return eventListeners[event];
}

/**
 * Broadcast a saas lifecycle event to the automation triggers listening for
 * it. No-ops when nothing listens and never throws, so emit call sites in
 * business flows are always safe: a failing procedure must never break the
 * emitting business flow.
 */
export function emitAutomationEvent<E extends AutomationEventName>(
  event: E,
  payload: AutomationEventPayloads[E],
): void {
  for (const listener of listenersFor(event)) {
    // oxfmt-ignore
    try {
      void Promise.resolve(listener(payload)).catch(() => undefined);
    } catch {
    }
  }
}

/**
 * Broadcasts an event a procedure's write may have caused: it then carries
 * the procedure and its run, and passes the loop guard on its workspace first.
 */
export function emitOriginatedAutomationEvent<E extends AutomationEventName>(
  event: E,
  payload: AutomationEventPayloads[E],
): void {
  const origin = currentAutomationOrigin();
  if (
    origin.originProcedureId !== undefined &&
    !admitOriginatedEvent(event, payload.tenantId)
  )
    return;
  emitAutomationEvent(event, { ...payload, ...origin });
}
