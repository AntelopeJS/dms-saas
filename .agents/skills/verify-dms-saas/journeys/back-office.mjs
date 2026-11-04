import { guarded } from "../guard.mjs";
import { listRuleJourneys } from "./parts/list-rules.mjs";
import { operatorRuleJourneys } from "./parts/operator-rules.mjs";
import { revenueJourneys } from "./parts/revenue.mjs";
import { invoiceJourneys } from "./parts/invoices.mjs";
import { dashboardDateJourneys } from "./parts/back-office-more.mjs";
import { check, createPlan, fixture, list, pick, register, saas, text, withConfig } from "../saas.mjs";

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
    id: "the-headline-figures-normalise-and-count-only-paying-workspaces",
    title: "MRR counts a yearly plan for a twelfth and counts active and past-due paid workspaces, never trials, gifts or free ones",
    entryPoint: "GET /api/saas/dashboard/headline, /workspaces-by-status, /plans-by-mrr",
    async run(/** @type {Ctx} */ ctx) {
      const plans = await seed(ctx);
      const headline = await saas(ctx, "the headline", "GET", `${DASHBOARD}/headline`);
      const statuses = await saas(ctx, "workspaces by status", "GET", `${DASHBOARD}/workspaces-by-status`);
      const byPlan = await saas(ctx, "plans by MRR", "GET", `${DASHBOARD}/plans-by-mrr`);
      const count = (/** @type {string} */ id) => pick(item(statuses, id), "value");
      await ctx.verify("MRR and ARR are normalised and in the reporting currency", [
        check("MRR: 1000 (yearly 12000 / 12) + 50 + 50 (past due) = 1100.00 EUR in minor units", money(pick(item(headline, "mrr"), "value")) === 110000, item(headline, "mrr")),
        check("ARR: twelve months of it", money(pick(item(headline, "mrr"), "detail")) === 1320000, item(headline, "mrr")),
      ]);
      await ctx.verify("paying out of all, with the free ones and the trials", [
        check("3 paying of 7 workspaces (the default one included)", JSON.stringify(pick(item(headline, "paying"), "value", "params")) === JSON.stringify({ paying: 3, total: 7 }), item(headline, "paying")),
        check("free: the gift, the free workspace and the default one are not paying; trialing: 1", JSON.stringify(pick(item(headline, "paying"), "detail", "params")) === JSON.stringify({ free: 3, trialing: 1 }), item(headline, "paying")),
      ]);
      await ctx.verify("workspaces by status", [
        check("active 2 (monthly and yearly; the gift counts as free)", count("active") === 2, statuses.body),
        check("trialing 1, free 3", count("trialing") === 1 && count("free") === 3, statuses.body),
        check("past due 1", count("past_due") === 1, statuses.body),
        check("suspended, pending payment and cancelled 0", count("suspended") === 0 && count("pending_payment") === 0 && count("cancelled") === 0, statuses.body),
      ]);
      const rows = list(byPlan.body, "items");
      await ctx.verify("plans by MRR count only each plan's paying workspaces, highest first", [
        check("Pro 1000 then Team 100", JSON.stringify(rows.map((row) => [text(row, "title"), row.value])) === JSON.stringify([["Pro", 1000], ["Team", 100]]), rows),
        check("the plans exist", plans.pro !== "" && plans.team !== "", plans),
      ]);
    },
  },
  {
    id: "mrr-is-reported-in-the-configured-currency-only",
    title: "with a reporting currency other than the plans' currency MRR shows 0 for them (never converted), and the code is read in upper case",
    entryPoint: "GET /api/saas/dashboard/headline, option reportingCurrency",
    async run(/** @type {Ctx} */ ctx) {
      await seed(ctx);
      await withConfig(ctx, { VERIFY_SAAS_REPORTING_CURRENCY: "usd" }, async () => {
        const headline = await saas(ctx, "the headline in usd", "GET", `${DASHBOARD}/headline`);
        const mrr = pick(item(headline, "mrr"), "value", "params", "value");
        await ctx.verify("EUR plans are not converted into the reporting currency", [
          check("the MRR is in USD (read in upper case)", pick(mrr, "currency") === "USD", mrr),
          check("and it is 0, the EUR amounts are shown apart", pick(mrr, "value") === 0, mrr),
        ]);
      });
    },
  },
  {
    id: "only-the-platform-owner-reads-the-dashboard",
    title: "a workspace owner and an anonymous caller are refused every dashboard block",
    entryPoint: "/api/saas/dashboard/*",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "snoop");
      const checks = [];
      for (const block of ["headline", "attention", "churn", "paid-invoices", "workspaces-by-status", "plans-by-mrr", "activity"]) {
        for (const who of ["snoop", "anon"]) {
          const answer = await saas(ctx, `${who} reads ${block}`, "GET", `${DASHBOARD}/${block}`, { as: who });
          checks.push(check(`${who}: ${block} is refused`, answer.status === 401 || answer.status === 403, answer.status));
        }
      }
      await ctx.verify("every block is the platform owner's", checks);
    },
  },
  ...dashboardDateJourneys,
  ...invoiceJourneys,
  ...revenueJourneys,
  ...operatorRuleJourneys,
  ...listRuleJourneys,
]);
