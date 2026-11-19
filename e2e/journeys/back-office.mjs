import { guarded } from "../guard.mjs";
import { listRuleJourneys } from "./parts/list-rules.mjs";
import { operatorRuleJourneys } from "./parts/operator-rules.mjs";
import { check, createPlan, fixture, list, pick, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const DASHBOARD = "/dashboard";

/**
 * Puts a registered workspace on a plan in a billing state, as a paid flow would leave it.
 *
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The billing status
 * @param {boolean} [isComplimentary] Whether the access is a gift
 */
async function setSubscription(ctx, tenantId, planId, status, isComplimentary = false) {
  await fixture(ctx, `put ${tenantId} on its plan as ${status}`, "POST", "/subscription", {
    tenantId,
    planId,
    status,
    stripeCustomerId: isComplimentary ? undefined : `cus_${tenantId.slice(0, 8)}`,
    stripeSubscriptionId: isComplimentary ? undefined : `sub_${tenantId.slice(0, 8)}`,
    isComplimentary,
  });
}

/**
 * @param {import("../saas.mjs").Answer} answer A dashboard answer
 * @param {string} id An item id
 * @returns {unknown} The item
 */
function item(answer, id) {
  return list(answer.body, "items").find((entry) => text(entry, "id") === id);
}

/** @param {unknown} node A payload node @returns {unknown} The money amount it holds, in minor units */
function money(node) {
  return pick(node, "params", "value", "value") ?? pick(node, "params", "arr", "value");
}

/**
 * The shared seed of the dashboard journeys: two paid plans and six workspaces in every state that matters.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ pro: string, team: string }>} The paid plans
 */
async function seed(ctx) {
  await createPlan(ctx, "free", { order: 0 });
  const pro = await createPlan(ctx, "pro", { price: 12000, interval: "year", order: 1, name: { en: "Pro" } });
  const team = await createPlan(ctx, "team", { price: 50, interval: "month", order: 2, name: { en: "Team" } });
  const states = [
    ["yearly", pro.id, "active", false],
    ["monthly", team.id, "active", false],
    ["late", team.id, "past_due", false],
    ["trial", team.id, "trialing", false],
    ["gift", pro.id, "active", true],
  ];
  for (const [name, planId, status, gift] of states) {
    const visitor = await register(ctx, String(name));
    await setSubscription(ctx, visitor.tenantId, String(planId), String(status), gift === true);
  }
  await register(ctx, "free-one");
  return { pro: pro.id, team: team.id };
}

/** Modules › SaaS › Dashboard: the platform owner's figures, from workspaces in every billing state. */
export const journeys = guarded([
  {
    id: "the-dashboard-page-draws-the-figures-the-dashboard-api-answers",
    title: "the Dashboard page shows the MRR, ARR, paying workspaces, the workspaces by status and the plans by MRR that the dashboard blocks answer for workspaces in every billing state",
    entryPoint: "Modules › SaaS › Dashboard, GET /api/saas/dashboard/headline, /workspaces-by-status, /plans-by-mrr",
    async run(/** @type {Ctx} */ ctx) {
      await seed(ctx);
      const headline = await saas(ctx, "the headline", "GET", `${DASHBOARD}/headline`);
      const statuses = await saas(ctx, "workspaces by status", "GET", `${DASHBOARD}/workspaces-by-status`);
      const byPlan = await saas(ctx, "plans by MRR", "GET", `${DASHBOARD}/plans-by-mrr`);
      const euros = (/** @type {unknown} */ minor) => new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(Number(minor) / 100);
      const count = (/** @type {string} */ id) => String(pick(item(statuses, id), "value"));
      const paying = pick(item(headline, "paying"), "value", "params");
      const mrr = RegExp.escape(euros(money(pick(item(headline, "mrr"), "value"))));
      const arr = RegExp.escape(euros(money(pick(item(headline, "mrr"), "detail"))));
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/overview/dashboard");
      await ctx.verify("the page draws the headline figures", [
        tab.shows(new RegExp(`MRR · normalised\\s*${mrr}`, "i"), { timeoutMs: 60_000 }),
        tab.shows(new RegExp(`ARR ${arr}`), { timeoutMs: 15_000 }),
        tab.visible({ role: "link", name: new RegExp(`Paying workspaces ${String(pick(paying, "paying"))} / ${String(pick(paying, "total"))}`) }, { timeoutMs: 15_000 }),
      ]);
      await ctx.verify("the page counts the workspaces by status as the block does", [
        tab.shows(new RegExp(`Active\\s*${count("active")}\\s*Trialing\\s*${count("trialing")}\\s*Free\\s*${count("free")}\\s*Past due\\s*${count("past_due")}`), { timeoutMs: 15_000 }),
      ]);
      const plans = list(byPlan.body, "items").map((row) => RegExp.escape(text(row, "title")));
      await ctx.verify("the page lists the plans that bring revenue", [
        check("the block answers the two paid plans", plans.length === 2, byPlan.body),
        tab.shows(new RegExp(`Plans by MRR[\\s\\S]*${plans.join("[\\s\\S]*")}`, "i"), { timeoutMs: 15_000 }),
      ]);
    },
  },
  ...operatorRuleJourneys,
  ...listRuleJourneys,
]);
