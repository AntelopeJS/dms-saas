import { z } from "zod";
import type { Answer, Journey, JsonObject } from "./journey.ts";
import { fixture, register } from "./saas.ts";

const NOTIFICATIONS_API = "/dms/pages/settings/user/notifications/list";
const DAY_SECONDS = 86_400;
const PERIOD_DAYS = 30;

const admittedEvents = z.array(
  z.object({ id: z.string(), type: z.string(), result: z.string() }),
);
const subscriptionRow = z.object({
  status: z.string().nullable(),
  pastDueSince: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  isComplimentary: z.boolean(),
});
const notifications = z.array(z.object({}).passthrough());

export const now = (): number => Math.floor(Date.now() / 1000);

/** The webhook events the module admitted, as the playground records them. */
export async function admitted(journey: Journey) {
  const answer = await fixture(
    journey,
    "the admitted webhook events",
    "GET",
    "/webhook-events",
  );
  return admittedEvents.parse(answer.body);
}

/** The subscription row of a workspace: status, past-due date, Stripe subscription id and complimentary flag. */
export async function rowOf(journey: Journey, tenantId: string) {
  const answer = await fixture(
    journey,
    `the subscription row of ${tenantId}`,
    "GET",
    `/subscription-state/${tenantId}`,
  );
  return subscriptionRow.parse(answer.body);
}

/** The status a workspace's subscription row holds. */
export async function statusOf(journey: Journey, tenantId: string) {
  return (await rowOf(journey, tenantId)).status;
}

/** Registers a workspace and puts it on a paid plan in `status`, holding a Stripe customer of its own. */
export async function holder(
  journey: Journey,
  name: string,
  planId: string,
  status: string,
): Promise<{ tenantId: string; customer: string }> {
  const visitor = await register(journey, name, { workspaceName: name });
  const customer = `cus_${name}`.replace(/[^a-z0-9_]/gi, "_");
  await fixture(journey, `put ${name} as ${status}`, "POST", "/subscription", {
    tenantId: visitor.tenantId,
    planId,
    status,
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${name}`.replace(/[^a-z0-9_]/gi, "_"),
  });
  return { tenantId: visitor.tenantId, customer };
}

/** The cancellation notices an account's notification feed holds, read through the dashboard's own notifications API. */
export async function cancellationNotices(
  journey: Journey,
  account: string,
): Promise<{ answer: Answer; notices: number }> {
  const answer = await journey.api(`the notifications of ${account}`, {
    method: "GET",
    path: NOTIFICATIONS_API,
    as: account,
  });
  const rows = notifications.safeParse(answer.body).data ?? [];
  return {
    answer,
    notices: rows.filter((row) =>
      JSON.stringify(row).includes("subscription_cancelled"),
    ).length,
  };
}

/** A Stripe subscription as an event carries it. */
export function stripeSubscription(
  customer: string,
  subscriptionId: string,
  status: string,
): JsonObject {
  const start = now() - DAY_SECONDS;
  return {
    id: subscriptionId,
    object: "subscription",
    customer,
    status,
    start_date: start,
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          current_period_start: start,
          current_period_end: start + PERIOD_DAYS * DAY_SECONDS,
        },
      ],
      has_more: false,
    },
    metadata: {},
  };
}

/** A Stripe invoice as an event carries it. */
export function stripeInvoice(
  customer: string,
  id: string,
  status: string,
  amount: number,
): JsonObject {
  const created = now() - 3600;
  const paid = status === "paid";
  return {
    id,
    object: "invoice",
    customer,
    number: `N-${id}`,
    status,
    billing_reason: "subscription_cycle",
    currency: "eur",
    amount_due: amount,
    amount_paid: paid ? amount : 0,
    amount_remaining: paid ? 0 : amount,
    subtotal: amount,
    total: amount,
    created,
    period_start: created,
    period_end: created + PERIOD_DAYS * DAY_SECONDS,
    attempt_count: 1,
    status_transitions: {
      finalized_at: created,
      paid_at: paid ? now() : null,
      voided_at: null,
      marked_uncollectible_at: null,
    },
    lines: { object: "list", data: [], has_more: false },
    metadata: {},
    parent: null,
  };
}
