export type SubscriptionStartedEvent = {
  tenantId: string;
  planId: string | null;
  status: string;
  stripeSubscriptionId: string;
  /**
   * False when the checkout was trialing but the internal trial-consumption
   * row could not be recorded (missing email/creator/plan, or already
   * recorded); workflows must not assume a usage row exists.
   */
  trialConsumptionRecorded: boolean;
  at: string;
};

export type SubscriptionCancelledEvent = {
  tenantId: string;
  stripeSubscriptionId: string;
  at: string;
};

export type PaymentFailedEvent = {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amountDue: number;
  currency: string;
  at: string;
};

export type TrialEndingEvent = {
  tenantId: string;
  trialEndsAt: string | null;
  at: string;
};

export type TenantDeletedEvent = {
  tenantId: string;
  at: string;
  /** Consumers must deduplicate non-idempotent effects by this identity on replay. */
  operationId?: string;
};

export interface AutomationEventPayloads {
  "saas.subscription-started": SubscriptionStartedEvent;
  "saas.subscription-cancelled": SubscriptionCancelledEvent;
  "saas.payment-failed": PaymentFailedEvent;
  "saas.trial-ending": TrialEndingEvent;
  "saas.tenant-deleted": TenantDeletedEvent;
}

export type AutomationEventName = keyof AutomationEventPayloads;

export type AutomationEventListener = (
  payload: AutomationEventPayloads[AutomationEventName],
) => void | Promise<void>;

const eventListeners = new Map<
  AutomationEventName,
  Set<AutomationEventListener>
>();

export function listenersFor(
  event: AutomationEventName,
): Set<AutomationEventListener> {
  const existing = eventListeners.get(event);
  if (existing) return existing;
  const created = new Set<AutomationEventListener>();
  eventListeners.set(event, created);
  return created;
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

/** Propagates deletion trigger failures; delivery may repeat and is not exactly-once execution. */
export async function emitTenantDeletedEvent(
  payload: TenantDeletedEvent,
): Promise<void> {
  for (const listener of listenersFor("saas.tenant-deleted"))
    await listener(payload);
}
