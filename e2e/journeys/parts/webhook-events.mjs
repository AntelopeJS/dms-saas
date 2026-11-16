import { check, createPlan, deliverEvent, fixture, list, register, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const NOW = () => Math.floor(Date.now() / 1000);

/**
 * Registers a workspace and puts it on a paid plan in `status`, holding a Stripe customer of its own.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name
 * @param {string} planId The plan
 * @param {string} status The status
 * @returns {Promise<{ tenantId: string, customer: string }>} The workspace and its customer id
 */
async function holder(ctx, name, planId, status) {
  const visitor = await register(ctx, name, { workspaceName: name });
  const customer = `cus_${name}`.replace(/[^a-z0-9_]/gi, "_");
  await fixture(ctx, `put ${name} as ${status}`, "POST", "/subscription", {
    tenantId: visitor.tenantId,
    planId,
    status,
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${name}`.replace(/[^a-z0-9_]/gi, "_"),
  });
  return { tenantId: visitor.tenantId, customer };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @returns {Promise<string>} Its subscription status
 */
async function statusOf(ctx, tenantId) {
  return text((await fixture(ctx, `the subscription of ${tenantId}`, "GET", `/subscription-state/${tenantId}`)).body, "status");
}

/**
 * A Stripe subscription as an event carries it.
 *
 * @param {string} customer The customer id
 * @param {string} subscriptionId The subscription id
 * @param {string} status Stripe's status
 * @returns {Record<string, unknown>} The subscription object
 */
function stripeSubscription(customer, subscriptionId, status) {
  const start = NOW() - 86_400;
  return { id: subscriptionId, object: "subscription", customer, status, start_date: start, items: { object: "list", data: [{ id: "si_1", current_period_start: start, current_period_end: start + 30 * 86_400 }], has_more: false }, metadata: {} };
}

/**
 * A Stripe invoice as an event carries it.
 *
 * @param {string} customer The customer id
 * @param {string} id The invoice id
 * @param {string} status Stripe's status
 * @param {number} amount The amount in minor units
 * @returns {Record<string, unknown>} The invoice object
 */
function stripeInvoice(customer, id, status, amount) {
  const created = NOW() - 3600;
  return {
    id,
    object: "invoice",
    customer,
    number: `N-${id}`,
    status,
    billing_reason: "subscription_cycle",
    currency: "eur",
    amount_due: amount,
    amount_paid: status === "paid" ? amount : 0,
    amount_remaining: status === "paid" ? 0 : amount,
    subtotal: amount,
    total: amount,
    created,
    period_start: created,
    period_end: created + 30 * 86_400,
    attempt_count: 1,
    status_transitions: { finalized_at: created, paid_at: status === "paid" ? NOW() : null, voided_at: null, marked_uncollectible_at: null },
    lines: { object: "list", data: [], has_more: false },
    metadata: {},
    parent: null,
  };
}

/** The Stripe events that move a workspace, driven with signed payloads per starting status. */
export const webhookEventJourneys = [
  {
    id: "a-trial-that-ends-follows-the-status-stripe-reports",
    title: "customer.subscription.updated after a trial moves the workspace to past due when the first charge fails (past_due, unpaid, incomplete_expired) and to active when it succeeds, and leaves it alone without the trial marker",
    entryPoint: "POST /api/saas/webhooks/stripe, customer.subscription.updated",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const cases = [
        { name: "trial-pastdue", stripe: "past_due", expected: "past_due" },
        { name: "trial-unpaid", stripe: "unpaid", expected: "past_due" },
        { name: "trial-expired", stripe: "incomplete_expired", expected: "past_due" },
        { name: "trial-active", stripe: "active", expected: "active" },
      ];
      const results = [];
      for (const entry of cases) {
        const held = await holder(ctx, entry.name, pro.id, "trialing");
        const delivered = await deliverEvent(ctx, entry.name, { type: "customer.subscription.updated", id: `evt_${entry.name}`, object: stripeSubscription(held.customer, `sub_${entry.name}`.replace(/-/g, "_"), entry.stripe) }, { previousAttributes: { status: "trialing" } });
        results.push(check(`${entry.stripe}: acknowledged and the workspace is ${entry.expected}`, delivered.status === 200 && (await statusOf(ctx, held.tenantId)) === entry.expected, [delivered, await statusOf(ctx, held.tenantId)]));
      }
      await ctx.verify("a trial's end follows Stripe's status", results);
      const plain = await holder(ctx, "trial-plain", pro.id, "trialing");
      const unmarked = await deliverEvent(ctx, "an update without the trial marker", { type: "customer.subscription.updated", id: "evt_trial_plain", object: stripeSubscription(plain.customer, "sub_trial_plain", "past_due") });
      await ctx.verify("an update that does not come from a trial changes no status", [check("acknowledged, still trialing", unmarked.status === 200 && (await statusOf(ctx, plain.tenantId)) === "trialing", unmarked)]);
    },
  },
  {
    id: "a-failed-payment-moves-only-the-workspaces-that-can-fall-past-due",
    title: "invoice.payment_failed moves active and trialing workspaces to past due, mirrors the invoice, and leaves suspended and cancelled workspaces as they are",
    entryPoint: "POST /api/saas/webhooks/stripe, invoice.payment_failed",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const cases = [
        { status: "active", expected: "past_due" },
        { status: "trialing", expected: "past_due" },
        { status: "suspended", expected: "suspended" },
        { status: "cancelled", expected: "cancelled" },
      ];
      const results = [];
      for (const entry of cases) {
        const name = `fail-${entry.status}`;
        const held = await holder(ctx, name, pro.id, entry.status);
        const delivered = await deliverEvent(ctx, name, { type: "invoice.payment_failed", id: `evt_${name}`, object: stripeInvoice(held.customer, `in_${name}`, "open", 5000) });
        results.push(check(`${entry.status}: acknowledged and ${entry.expected}`, delivered.status === 200 && (await statusOf(ctx, held.tenantId)) === entry.expected, [delivered, await statusOf(ctx, held.tenantId)]));
      }
      await ctx.verify("a failed charge moves only the states that can fall past due", results);
    },
  },
  {
    id: "invoice-paid-reactivates-a-workspace-only-when-no-invoice-is-left-open",
    title: "a past-due workspace with two open invoices stays past due when one is paid and becomes active when the second is paid",
    entryPoint: "POST /api/saas/webhooks/stripe, invoice.paid",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const held = await holder(ctx, "owes-two", pro.id, "past_due");
      const customer = held.customer;
      const first = await deliverEvent(ctx, "first invoice fails", { type: "invoice.payment_failed", id: "evt_two_fail_1", object: stripeInvoice(customer, "in_two_1", "open", 3000) });
      const second = await deliverEvent(ctx, "second invoice fails", { type: "invoice.payment_failed", id: "evt_two_fail_2", object: stripeInvoice(customer, "in_two_2", "open", 4000) });
      await ctx.verify("two invoices are open", [check("both deliveries acknowledged", first.status === 200 && second.status === 200, [first, second]), check("still past due", (await statusOf(ctx, held.tenantId)) === "past_due", "status")]);
      const paidOne = await deliverEvent(ctx, "first invoice paid", { type: "invoice.paid", id: "evt_two_paid_1", object: stripeInvoice(customer, "in_two_1", "paid", 3000) });
      await ctx.verify("one invoice paid, one still open: the workspace stays past due", [check("acknowledged and past due", paidOne.status === 200 && (await statusOf(ctx, held.tenantId)) === "past_due", paidOne)]);
      const paidTwo = await deliverEvent(ctx, "second invoice paid", { type: "invoice.paid", id: "evt_two_paid_2", object: stripeInvoice(customer, "in_two_2", "paid", 4000) });
      await ctx.verify("the last open invoice paid: the workspace is active again", [check("acknowledged and active", paidTwo.status === 200 && (await statusOf(ctx, held.tenantId)) === "active", paidTwo)]);
    },
  },
  {
    id: "a-redelivered-handled-event-is-applied-once",
    title: "the same payment_failed event delivered twice is admitted once and leaves the date the workspace fell past due unchanged",
    entryPoint: "POST /api/saas/webhooks/stripe",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const held = await holder(ctx, "redelivered", pro.id, "active");
      const event = { type: "invoice.payment_failed", id: "evt_redelivered_1", object: stripeInvoice(held.customer, "in_redelivered", "open", 5000) };
      const once = await deliverEvent(ctx, "first delivery", event);
      const since = text((await fixture(ctx, "the subscription after the first delivery", "GET", `/subscription-state/${held.tenantId}`)).body, "pastDueSince");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const twice = await deliverEvent(ctx, "redelivery", event);
      const state = (await fixture(ctx, "the subscription after the redelivery", "GET", `/subscription-state/${held.tenantId}`)).body;
      const admitted = list((await fixture(ctx, "the admitted events", "GET", "/webhook-events")).body).filter((row) => text(row, "id") === "evt_redelivered_1");
      await ctx.verify("the second delivery changes nothing", [
        check("both acknowledged", once.status === 200 && twice.status === 200, [once, twice]),
        check("past due after the first", text(state, "status") === "past_due" && since !== "", state),
        check("the past-due date did not move", text(state, "pastDueSince") === since, [since, state]),
        check("one admission record, settled as success", admitted.length === 1 && text(admitted[0], "result") === "success", admitted),
      ]);
    },
  },
];
