import { guarded } from "../guard.mjs";
import { webhookEventJourneys } from "./parts/webhook-events.mjs";
import { check, deliverEvent, fixture, isText, list, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const SIGNATURE_ERROR = "saas.errors.webhook.invalid_signature";

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../saas.mjs").Row[]>} The admitted events
 */
async function admitted(ctx) {
  return list((await fixture(ctx, "the admitted webhook events", "GET", "/webhook-events")).body);
}

/** The Stripe webhook endpoint: signature, admission, deduplication and the events the module ignores. */
export const journeys = guarded([
  {
    id: "a-delivery-needs-a-valid-signature",
    title: "an unsigned, wrongly signed or stale delivery is refused with 400 and admits nothing, a correctly signed one is received",
    entryPoint: "POST /api/saas/webhooks/stripe",
    async run(/** @type {Ctx} */ ctx) {
      const event = { type: "product.created", id: "evt_sig_ok", object: { id: "prod_1" } };
      const unsigned = await deliverEvent(ctx, "without a signature", { ...event, id: "evt_sig_none" }, { secret: null });
      const wrong = await deliverEvent(ctx, "signed with another secret", { ...event, id: "evt_sig_wrong" }, { secret: "whsec_someone_else" });
      const stale = await deliverEvent(ctx, "signed ten minutes ago", { ...event, id: "evt_sig_stale" }, { timestamp: Math.floor(Date.now() / 1000) - 600 });
      const none = await admitted(ctx);
      await ctx.verify("a bad delivery is refused and leaves no record", [
        check("no signature: 400 saas.errors.webhook.invalid_signature", unsigned.status === 400 && unsigned.body === SIGNATURE_ERROR, unsigned.body),
        check("another secret: 400 saas.errors.webhook.invalid_signature", wrong.status === 400 && wrong.body === SIGNATURE_ERROR, wrong.body),
        check("a timestamp outside the five-minute tolerance: 400", stale.status === 400 && stale.body === SIGNATURE_ERROR, stale.body),
        check("no event was admitted", none.length === 0, none),
      ]);
      const good = await deliverEvent(ctx, "signed with the endpoint secret", event);
      await ctx.verify("a correctly signed delivery is received", [check("200 { received: true }", good.status === 200 && JSON.stringify(good.body) === JSON.stringify({ received: true }), good.body)]);
    },
  },
  {
    id: "an-event-the-module-does-not-handle-is-recorded-skipped-once",
    title: "an unhandled event type is acknowledged and recorded as skipped, and a redelivery of the same event id changes nothing",
    entryPoint: "POST /api/saas/webhooks/stripe",
    async run(/** @type {Ctx} */ ctx) {
      const unhandled = { type: "product.created", id: "evt_skip_1", object: { id: "prod_9" } };
      const first = await deliverEvent(ctx, "an unhandled event", unhandled);
      const again = await deliverEvent(ctx, "the same event again", unhandled);
      const rows = await admitted(ctx);
      const mine = rows.filter((row) => text(row, "id") === "evt_skip_1");
      await ctx.verify("acknowledged, recorded as skipped, deduplicated", [
        check("both deliveries are acknowledged", first.status === 200 && again.status === 200, [first.body, again.body]),
        check("one record for the event id", mine.length === 1, rows),
        check("its type and result: product.created, skipped", mine.length === 1 && text(mine[0], "type") === "product.created" && text(mine[0], "result") === "skipped", mine),
      ]);
      const other = await deliverEvent(ctx, "another unhandled event", { type: "price.created", id: "evt_skip_2", object: { id: "price_1" } });
      const all = await admitted(ctx);
      await ctx.verify("each event id has its own record", [
        check("acknowledged", other.status === 200, other.body),
        check("two records, both skipped", all.length === 2 && all.every((row) => text(row, "result") === "skipped" && isText(text(row, "id"))), all),
      ]);
    },
  },
  {
    id: "an-event-for-an-unknown-customer-moves-no-workspace",
    title: "a handled event that names a Stripe customer no workspace holds is acknowledged and never ends in reconciliation",
    entryPoint: "POST /api/saas/webhooks/stripe",
    async run(/** @type {Ctx} */ ctx) {
      const events = [
        { type: "customer.updated", id: "evt_cu_1", object: { id: "cus_nobody", email: "x@verify.local" } },
        { type: "customer.subscription.deleted", id: "evt_sd_1", object: { id: "sub_nobody", customer: "cus_nobody", status: "canceled", items: { data: [] } } },
        { type: "customer.subscription.trial_will_end", id: "evt_tw_1", object: { id: "sub_nobody", customer: "cus_nobody", status: "trialing", items: { data: [] } } },
      ];
      const answers = [];
      for (const event of events) answers.push(await deliverEvent(ctx, event.type, event));
      const rows = await admitted(ctx);
      await ctx.verify("acknowledged and settled, not stuck", [
        check("every delivery is acknowledged", answers.every((answer) => answer.status === 200), answers),
        check("one record per event", events.every((event) => rows.filter((row) => text(row, "id") === event.id).length === 1), rows),
        check("none is pending or in reconciliation", rows.every((row) => text(row, "result") === "success" || text(row, "result") === "skipped"), rows),
      ]);
    },
  },
  ...webhookEventJourneys,
]);
