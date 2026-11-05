import { check, createPlan, fixture, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {{ number: string, documentType: "invoice" | "credit_note", status: string, totalMinor: number, daysAgo: number }} mirrored The document
 */
async function document(ctx, tenantId, mirrored) {
  await fixture(ctx, `mirror ${mirrored.number}`, "POST", "/invoice", { tenantId, currency: "EUR", ...mirrored });
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The status
 */
async function subscription(ctx, tenantId, planId, status) {
  await fixture(ctx, `put ${tenantId} on its plan as ${status}`, "POST", "/subscription", { tenantId, planId, status, stripeCustomerId: `cus_${tenantId.slice(0, 8)}`, stripeSubscriptionId: `sub_${tenantId.slice(0, 8)}` });
}

/**
 * @param {number} daysAgo How long ago
 * @returns {string} That day as YYYY-MM-DD
 */
function day(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {import("../../saas.mjs").Answer} answer A chart answer
 * @param {string} suffix The series name's last segment
 * @returns {number} The sum of that series
 */
function seriesTotal(answer, suffix) {
  const series = list(answer.body, "series").find((entry) => text(entry, "name").endsWith(suffix));
  return list(series, "data").reduce((sum, point) => sum + Number(point.y), 0);
}

/** Revenue churn and Paid invoices, from invoices and cancellations mirrored through the fixture. */
export const revenueJourneys = [
  {
    id: "revenue-churn-divides-the-lost-mrr-by-the-mrr-the-period-started-with",
    title: "a workspace cancelled in the period counts the MRR it paid, the rate is lost over today's MRR plus lost, and a period before the cancellation counts none",
    entryPoint: "GET /api/saas/dashboard/churn",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const keeper = await register(ctx, "keeper");
      const leaver = await register(ctx, "leaver");
      const never = await register(ctx, "never-paid");
      await subscription(ctx, keeper.tenantId, pro.id, "active");
      await subscription(ctx, leaver.tenantId, pro.id, "active");
      await document(ctx, leaver.tenantId, { number: "L-1", documentType: "invoice", status: "paid", totalMinor: 5000, daysAgo: 20 });
      const before = await saas(ctx, "churn before any cancellation", "GET", "/dashboard/churn");
      await subscription(ctx, leaver.tenantId, pro.id, "cancelled");
      await subscription(ctx, never.tenantId, pro.id, "trialing");
      await subscription(ctx, never.tenantId, pro.id, "cancelled");
      const after = await saas(ctx, "churn after the cancellations", "GET", "/dashboard/churn");
      const past = await saas(ctx, "churn over a period before the cancellations", "GET", `/dashboard/churn?from=${day(90)}&to=${day(60)}`);
      await ctx.verify("the lost MRR is read from what the workspace paid", [
        check("before: 0 %", pick(before.body, "value") === 0, before.body),
        check("one paying workspace left (50) and 50 lost: 50 %", pick(after.body, "value") === 50, after.body),
        check("a period that ends before the cancellations: 0 %", pick(past.body, "value") === 0, past.body),
      ]);
    },
  },
  {
    id: "paid-invoices-sums-collected-and-credited-money-per-day-with-a-comparison",
    title: "the chart sums paid invoices and issued credit notes inside the period, ignores open ones and other currencies, and the comparison reads the earlier window",
    entryPoint: "GET /api/saas/dashboard/paid-invoices",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const payer = await register(ctx, "invoice-payer");
      await document(ctx, payer.tenantId, { number: "P-1", documentType: "invoice", status: "paid", totalMinor: 4900, daysAgo: 3 });
      await document(ctx, payer.tenantId, { number: "P-2", documentType: "invoice", status: "paid", totalMinor: 1000, daysAgo: 10 });
      await document(ctx, payer.tenantId, { number: "O-1", documentType: "invoice", status: "open", totalMinor: 7000, daysAgo: 2 });
      await document(ctx, payer.tenantId, { number: "V-1", documentType: "invoice", status: "void", totalMinor: 3000, daysAgo: 2 });
      await document(ctx, payer.tenantId, { number: "C-1", documentType: "credit_note", status: "issued", totalMinor: 1500, daysAgo: 4 });
      await document(ctx, payer.tenantId, { number: "OLD-1", documentType: "invoice", status: "paid", totalMinor: 8000, daysAgo: 45 });
      const current = await saas(ctx, "paid invoices over 30 days", "GET", `/dashboard/paid-invoices?from=${day(29)}&to=${day(0)}`);
      await ctx.verify("only paid invoices are collected and only issued credit notes are credited", [
        check("collected in the period: 49.00 + 10.00 = 59", pick(current.body, "value") === 59, current.body),
        check("the collected series sums to 59", seriesTotal(current, "collected") === 59, current.body),
        check("the credited series sums to 15", seriesTotal(current, "credited") === 15, current.body),
        check("no comparison without a comparison window", pick(current.body, "previousValue") === undefined, current.body),
      ]);
      const compared = await saas(ctx, "paid invoices with a comparison window", "GET", `/dashboard/paid-invoices?from=${day(29)}&to=${day(0)}&compareFrom=${day(59)}&compareTo=${day(30)}&comparison=previous`);
      await ctx.verify("the comparison reads the earlier window", [
        check("the earlier window collected 80", pick(compared.body, "previousValue") === 80, compared.body),
        check("the value moved from 80 to 59: -26.25 %", pick(compared.body, "delta") === -26.25, compared.body),
        check("a comparison series is returned", list(compared.body, "comparisonSeries").length === 1, compared.body),
      ]);
      const none = await saas(ctx, "paid invoices with No comparison", "GET", `/dashboard/paid-invoices?from=${day(29)}&to=${day(0)}&comparison=none`);
      await ctx.verify("No comparison drops the comparison line and the change", [
        check("no previous value, no delta, no comparison series", pick(none.body, "previousValue") === undefined && pick(none.body, "delta") === undefined && pick(none.body, "comparisonSeries") === undefined, none.body),
      ]);
    },
  },
];
