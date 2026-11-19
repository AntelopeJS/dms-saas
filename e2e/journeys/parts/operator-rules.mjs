import { check, createPlan, fixture, isText, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const DAY_MS = 86_400_000;

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {number} days Days from now
 * @returns {string} That instant
 */
function inDays(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The status
 * @param {boolean} [stripe] Whether the subscription carries Stripe ids
 */
async function put(ctx, tenantId, planId, status, stripe = true) {
  await fixture(ctx, `put ${tenantId} as ${status}`, "POST", "/subscription", {
    tenantId,
    planId,
    status,
    stripeCustomerId: stripe ? `cus_${tenantId.slice(0, 8)}` : undefined,
    stripeSubscriptionId: stripe ? `sub_${tenantId.slice(0, 8)}` : undefined,
  });
}

/** Free access on a cancelled workspace and complimentary windows ending soon. */
export const operatorRuleJourneys = [
  {
    id: "free-access-is-refused-on-a-cancelled-workspace",
    title: "a workspace its owner deleted and a billed workspace that ended are refused free access through the API with saas.errors.workspace.is_cancelled and stay cancelled, and the header offers no grant",
    entryPoint: "POST /api/saas/workspaces/:tenantId/grant-free-access, Customers › Workspaces › a workspace",
    async run(/** @type {Ctx} */ ctx) {
      const plan = await createPlan(ctx, "gift", { order: 0 });
      const deleted = await register(ctx, "leaver", { workspaceName: "Deleted Co" });
      const removal = await saas(ctx, "the owner deletes the workspace", "POST", "/workspaces/current/delete", { as: "leaver", body: { confirmName: "Deleted Co" } });
      await ctx.verify("the owner's deletion is accepted", [check("200", removal.status === 200, removal.body)]);
      const ended = await register(ctx, "ended", { workspaceName: "Ended Co" });
      await put(ctx, ended.tenantId, plan.id, "cancelled", true);
      for (const [label, tenantId] of [["the deleted workspace", deleted.tenantId], ["the ended billed workspace", ended.tenantId]]) {
        const before = await saas(ctx, `${label} before the grant`, "GET", `/workspaces/${tenantId}/overview`);
        const grant = await saas(ctx, `grant free access to ${label}`, "POST", `/workspaces/${tenantId}/grant-free-access`, { body: { planId: plan.id } });
        const after = await saas(ctx, `${label} after the grant`, "GET", `/workspaces/${tenantId}/overview`);
        await ctx.verify(`${label} is refused and stays cancelled`, [
          check(`${label} is cancelled before the grant`, text(before.body, "status") === "cancelled", before.body),
          check(`${label}: 400 saas.errors.workspace.is_cancelled`, grant.status === 400 && code(grant) === "saas.errors.workspace.is_cancelled", grant.body),
          check(`${label} is still cancelled and not complimentary`, text(after.body, "status") === "cancelled" && pick(after.body, "isComplimentary") !== true, after.body),
        ]);
      }
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/saas/customers/workspaces/${deleted.tenantId}`);
      await ctx.verify("the header of the deleted workspace has no Grant free access button", [
        await tab.visible({ role: "heading", name: "Deleted Co" }, { timeoutMs: 60_000 }),
        await tab.visible({ role: "button", name: "Grant free access", exact: true }, { hidden: true, timeoutMs: 5_000 }),
      ]);
      await tab.goto(`/modules/saas/customers/workspaces/${ended.tenantId}`);
      await ctx.verify("the header of the ended billed workspace has no Change plan button", [
        await tab.visible({ role: "heading", name: "Ended Co" }, { timeoutMs: 60_000 }),
        await tab.visible({ role: "button", name: "Change plan", exact: true }, { hidden: true, timeoutMs: 5_000 }),
      ]);
      await tab.click({ role: "button", name: "More actions" });
      await ctx.verify("its menu shows Grant free access disabled", [await tab.enabled({ role: "menuitem", name: "Grant free access" }, { disabled: true, timeoutMs: 10_000 })]);
    },
  },
  {
    id: "complimentary-access-ending-within-7-days-is-flagged",
    title: "access granted until 5 days from now is flagged on Needs attention and under the Complimentary access ending view, one ending in 10 days is not",
    entryPoint: "GET /api/saas/dashboard/attention, Customers › Workspaces",
    async run(/** @type {Ctx} */ ctx) {
      const plan = await createPlan(ctx, "gift", { order: 0 });
      const soon = await register(ctx, "soon", { workspaceName: "Soon Co" });
      const later = await register(ctx, "later", { workspaceName: "Later Co" });
      const grant = (/** @type {string} */ tenantId, /** @type {number} */ days) => saas(ctx, `grant for ${days} days`, "POST", `/workspaces/${tenantId}/grant-free-access`, { body: { planId: plan.id, freeUntil: inDays(days) } });
      const grants = [await grant(soon.tenantId, 5), await grant(later.tenantId, 10)];
      const attention = await saas(ctx, "attention with two grants", "GET", "/dashboard/attention");
      const card = list(attention.body, "items").find((entry) => text(entry, "id") === "complimentary_ending");
      await ctx.verify("only the grant ending within 7 days is flagged", [
        check("both grants are accepted", grants.every((answer) => answer.status === 200), grants.map((answer) => answer.body)),
        check("the card counts 1", pick(card, "title", "params", "count", "value") === 1, card),
        check("and names the workspace", pick(card, "description", "params", "name") === "Soon Co", card),
        check("the card opens the view", text(card, "to") === "/modules/saas/customers/workspaces?view=complimentary-ending", card),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/customers/workspaces");
      await ctx.verify("the view counts and lists it", [tab.visible({ role: "button", name: "Complimentary access ending this week 1" }, { timeoutMs: 60_000 })]);
      await tab.click({ role: "button", name: "Complimentary access ending this week 1" });
      await ctx.verify("and lists only that workspace", [tab.shows(/Soon Co/, { timeoutMs: 30_000 }), tab.shows(/Later Co/, { timeoutMs: 5_000, not: true })]);
    },
  },
];
