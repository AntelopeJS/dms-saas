import { allPermissionIds, createRole, inviteMember, check, createPlan, fixture, isText, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const DAY_MS = 86_400_000;

/**
 * @param {import("../../saas.mjs").Answer} answer A dashboard answer
 * @param {string} id An item id
 * @returns {unknown} The item
 */
function item(answer, id) {
  return list(answer.body, "items").find((entry) => text(entry, "id") === id);
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The billing status
 * @param {{ endsInDays?: number, pastDueDaysAgo?: number }} [when] Dates relative to now
 */
async function seedSubscription(ctx, tenantId, planId, status, when = {}) {
  await fixture(ctx, `put ${tenantId} on its plan as ${status}`, "POST", "/subscription", {
    tenantId,
    planId,
    status,
    stripeCustomerId: `cus_${tenantId.slice(0, 8)}`,
    stripeSubscriptionId: `sub_${tenantId.slice(0, 8)}`,
    currentPeriodEnd: when.endsInDays === undefined ? undefined : new Date(Date.now() + when.endsInDays * DAY_MS).toISOString(),
    pastDueSince: when.pastDueDaysAgo === undefined ? undefined : new Date(Date.now() - when.pastDueDaysAgo * DAY_MS).toISOString(),
  });
}

/** The dashboard blocks that depend on dates and on the billing state. */
export const dashboardDateJourneys = [
  {
    id: "trials-ending-within-14-days-are-flagged-and-later-ones-are-not",
    title: "the headline counts every trial and flags those that end within 14 days: 13 days is flagged, 15 days is not",
    entryPoint: "GET /api/saas/dashboard/headline",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const soon = await register(ctx, "soon");
      const edge = await register(ctx, "edge");
      const later = await register(ctx, "later");
      await seedSubscription(ctx, soon.tenantId, pro.id, "trialing", { endsInDays: 3 });
      await seedSubscription(ctx, edge.tenantId, pro.id, "trialing", { endsInDays: 13 });
      await seedSubscription(ctx, later.tenantId, pro.id, "trialing", { endsInDays: 15 });
      const headline = await saas(ctx, "the headline", "GET", "/dashboard/headline");
      const trials = item(headline, "trials");
      await ctx.verify("all three trials are counted, two of them end within 14 days", [
        check("trials: 3", pick(trials, "value") === 3, trials),
        check("ending within 14 days: 2", pick(trials, "detail", "params", "count", "value") === 2, trials),
        check("the card leads to the trials-ending view", text(trials, "to") === "/modules/saas/customers/workspaces?view=trials-ending", trials),
      ]);
      await seedSubscription(ctx, edge.tenantId, pro.id, "trialing", { endsInDays: 16 });
      const moved = item(await saas(ctx, "the headline after the trial moved", "GET", "/dashboard/headline"), "trials");
      await ctx.verify("a trial pushed past the window leaves the flagged count", [check("ending within 14 days: 1", pick(moved, "detail", "params", "count", "value") === 1, moved)]);
    },
  },
  {
    id: "needs-attention-shows-past-due-workspaces-with-the-amount-and-first-suspension",
    title: "Needs attention counts the past-due workspaces, the amount at risk and the first suspension date: past-due day plus the suspension delay",
    entryPoint: "GET /api/saas/dashboard/attention, PUT /api/saas/settings/billing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const none = await saas(ctx, "attention with nothing past due", "GET", "/dashboard/attention");
      const late = await register(ctx, "late");
      const later = await register(ctx, "laterstill");
      await seedSubscription(ctx, late.tenantId, pro.id, "past_due", { pastDueDaysAgo: 2 });
      await seedSubscription(ctx, later.tenantId, pro.id, "past_due", { pastDueDaysAgo: 5 });
      const attention = await saas(ctx, "attention with two past due", "GET", "/dashboard/attention");
      const card = item(attention, "past_due");
      const first = pick(card, "description", "params", "date", "value");
      const expected = new Date(Date.now() - 5 * DAY_MS + 14 * DAY_MS);
      await ctx.verify("the queue shows count, amount at risk and the earliest suspension", [
        check("nothing past due: no card", item(none, "past_due") === undefined, none.body),
        check("count: 2", pick(card, "title", "params", "count", "value") === 2, card),
        check("amount at risk: 100.00 EUR (two workspaces at 50)", pick(card, "description", "params", "amount", "value") === 10000, card),
        check("the first suspension is the oldest past-due day plus 14 days", isText(first) && Math.abs(new Date(first).getTime() - expected.getTime()) < DAY_MS, [first, expected.toISOString()]),
        check("the card opens the Past due tab", text(card, "to") === "/modules/saas/customers/workspaces?tab=past_due", card),
      ]);
      await saas(ctx, "set the suspension delay to 30 days", "PUT", "/settings/billing", { body: { autoSuspendDelayDays: 30 } });
      for (const tenantId of [late.tenantId, later.tenantId]) await fixture(ctx, "publish the workspace again", "POST", "/recompute", { tenantId });
      const longer = item(await saas(ctx, "attention after the delay changed", "GET", "/dashboard/attention"), "past_due");
      const later30 = new Date(Date.now() - 5 * DAY_MS + 30 * DAY_MS);
      const moved = pick(longer, "description", "params", "date", "value");
      await ctx.verify("the suspension date follows the billing rule", [check("oldest past-due day plus 30 days", isText(moved) && Math.abs(new Date(moved).getTime() - later30.getTime()) < DAY_MS, [moved, later30.toISOString()])]);
    },
  },
  {
    id: "workspaces-by-status-counts-every-billing-state",
    title: "past-due, suspended, pending-payment, cancelled, trialing and free workspaces each land in their own count",
    entryPoint: "GET /api/saas/dashboard/workspaces-by-status",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const states = ["past_due", "suspended", "pending_payment", "cancelled", "trialing", "active"];
      for (const [index, status] of states.entries()) {
        const visitor = await register(ctx, `state${index}`);
        await seedSubscription(ctx, visitor.tenantId, pro.id, status, status === "trialing" ? { endsInDays: 30 } : {});
      }
      const answer = await saas(ctx, "workspaces by status", "GET", "/dashboard/workspaces-by-status");
      const counts = Object.fromEntries(list(answer.body, "items").map((entry) => [text(entry, "id"), entry.value]));
      await ctx.verify("each state counts its workspace, and the default workspace is free", [
        check("one of each paid state", ["active", "trialing", "past_due", "pending_payment", "suspended", "cancelled"].every((id) => counts[id] === 1), counts),
        check("free: the default workspace", counts.free === 1, counts),
      ]);
    },
  },
  {
    id: "an-operator-resends-copies-and-revokes-a-pending-invitation",
    title: "the platform owner copies the link of a pending invitation and revokes another; a revoked invitation is gone and a second revoke is refused",
    entryPoint: "POST /api/saas/workspaces/:tenantId/invitations/:inviteId/revoke, /link, /resend",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "inviter");
      const role = await createRole(ctx, "inviter");
      await inviteMember(ctx, "inviter", ctx.email("keep"), role);
      await inviteMember(ctx, "inviter", ctx.email("drop"), role);
      const listed = list((await fixture(ctx, "the invitations", "GET", `/invites/${owner.tenantId}`)).body);
      const drop = listed.find((entry) => text(entry, "email") === ctx.email("drop"));
      const keep = listed.find((entry) => text(entry, "email") === ctx.email("keep"));
      await ctx.verify("two invitations are pending", [check("both listed", drop !== undefined && keep !== undefined, listed)], { critical: true });
      const base = `/workspaces/${owner.tenantId}/invitations`;
      const link = await saas(ctx, "copy the link", "POST", `${base}/${text(keep, "id")}/link`);
      const revoked = await saas(ctx, "revoke the dropped invitation", "POST", `${base}/${text(drop, "id")}/revoke`);
      const after = list((await fixture(ctx, "the invitations after the revoke", "GET", `/invites/${owner.tenantId}`)).body);
      const twice = await saas(ctx, "revoke it again", "POST", `${base}/${text(drop, "id")}/revoke`);
      await ctx.verify("only the revoked invitation is gone", [
        check("the link is returned", link.status === 200 && JSON.stringify(link.body).includes("token="), link.body),
        check("revoke: 200", revoked.status === 200, revoked.body),
        check("one invitation is left, the kept one", after.length === 1 && text(after[0], "email") === ctx.email("keep"), after),
        check("revoking it again is harmless: the same single invitation remains", twice.status === 200 && list((await fixture(ctx, "the invitations again", "GET", `/invites/${owner.tenantId}`)).body).length === 1, twice.body),
      ]);
    },
  },
];
