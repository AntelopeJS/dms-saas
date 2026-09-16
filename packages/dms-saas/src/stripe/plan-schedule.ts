import type Stripe from "stripe";
import { stripeSecondsToDate } from "../utils/time";
import { getStripeClient } from "./client";

const RELEASE_END_BEHAVIOR = "release" as const;
const NEW_PHASE_ITERATIONS = 1;

export interface ScheduleDowngradeInput {
  stripeSubscriptionId: string;
  stripePriceId: string;
  quantity?: number;
}

function toPriceId(
  price: string | Stripe.Price | Stripe.DeletedPrice,
): string | undefined {
  return typeof price === "string" ? price : price.id;
}

function toPhaseItemParam(
  item: Stripe.SubscriptionSchedule.Phase.Item,
): Stripe.SubscriptionScheduleUpdateParams.Phase.Item {
  return { price: toPriceId(item.price), quantity: item.quantity };
}

function toCurrentPhaseParam(
  phase: Stripe.SubscriptionSchedule.Phase,
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  return {
    items: phase.items.map(toPhaseItemParam),
    start_date: phase.start_date,
    end_date: phase.end_date,
    automatic_tax: { enabled: true },
  };
}

/**
 * Parks a downgrade at the end of the running cycle: the customer keeps the
 * plan they paid for until then, and the renewal invoice is already priced at
 * the cheaper plan. The schedule releases itself afterwards, leaving a plain
 * subscription behind.
 */
export async function scheduleSubscriptionDowngrade(
  input: ScheduleDowngradeInput,
): Promise<Date | null> {
  const stripe = getStripeClient();
  // Deliberately not idempotency-keyed: scheduling, cancelling and scheduling
  // the same downgrade again would otherwise replay the released schedule from
  // Stripe's 24h cache and fail on the phase update. Stripe already refuses a
  // second schedule on a subscription, so a double submit fails safely.
  const created = await stripe.subscriptionSchedules.create({
    from_subscription: input.stripeSubscriptionId,
  });
  const currentPhase = created.phases[0];
  if (!currentPhase) return null;
  await stripe.subscriptionSchedules.update(created.id, {
    end_behavior: RELEASE_END_BEHAVIOR,
    phases: [
      toCurrentPhaseParam(currentPhase),
      {
        items: [{ price: input.stripePriceId, quantity: input.quantity }],
        iterations: NEW_PHASE_ITERATIONS,
        automatic_tax: { enabled: true },
      },
    ],
  });
  return stripeSecondsToDate(currentPhase.end_date);
}

const INERT_SCHEDULE_STATUSES = new Set(["released", "canceled", "completed"]);

/**
 * Idempotent release: a schedule that is already inert is fine, but a real
 * failure must propagate — swallowing it would let the caller clear the local
 * mirror while the live schedule still switches the billed price at renewal,
 * with no pending plan left to commit against.
 */
export async function releaseSubscriptionSchedule(
  scheduleId: string,
): Promise<void> {
  const stripe = getStripeClient();
  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (error) {
    const schedule = await stripe.subscriptionSchedules
      .retrieve(scheduleId)
      .catch(() => null);
    if (schedule && INERT_SCHEDULE_STATUSES.has(schedule.status)) return;
    throw error;
  }
}

export async function setSubscriptionCancelAtPeriodEnd(
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<Date | null> {
  const stripe = getStripeClient();
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });
  return stripeSecondsToDate(updated.current_period_end);
}

function toScheduleId(
  schedule: string | Stripe.SubscriptionSchedule | null,
): string | null {
  if (typeof schedule === "string") return schedule;
  return schedule?.id ?? null;
}

/**
 * Clears whatever pending state the subscription actually carries on Stripe —
 * attached schedule and end-of-cycle cancellation alike. Reading the
 * subscription rather than trusting a mirrored schedule id is what makes this
 * safe after partial failures: a half-configured replacement schedule left by
 * an aborted re-scheduling is found and released all the same.
 */
export async function resetSubscriptionPendingState(
  stripeSubscriptionId: string,
): Promise<void> {
  const stripe = getStripeClient();
  const subscription =
    await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const scheduleId = toScheduleId(subscription.schedule);
  if (scheduleId) await releaseSubscriptionSchedule(scheduleId);
  if (subscription.cancel_at_period_end) {
    await setSubscriptionCancelAtPeriodEnd(stripeSubscriptionId, false);
  }
}
