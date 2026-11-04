import { allPermissionIds, check, createPlan, fixture, isText, joinMember, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The status
 * @param {boolean} [gift] Whether the access is complimentary
 */
async function put(ctx, tenantId, planId, status, gift = false) {
  await fixture(ctx, `put ${tenantId} as ${status}`, "POST", "/subscription", {
    tenantId,
    planId,
    status,
    stripeCustomerId: gift ? undefined : `cus_${tenantId.slice(0, 8)}`,
    stripeSubscriptionId: gift ? undefined : `sub_${tenantId.slice(0, 8)}`,
    isComplimentary: gift,
  });
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {{ number: string, documentType: "invoice" | "credit_note", status: string, totalMinor: number, daysAgo: number }} mirrored The document
 */
async function mirror(ctx, tenantId, mirrored) {
  await fixture(ctx, `mirror ${mirrored.number}`, "POST", "/invoice", { tenantId, currency: "EUR", ...mirrored });
}

/** The back-office lists, figures and segment money columns. */
export const listRuleJourneys = [
  {
    id: "the-workspace-list-orders-by-mrr-and-its-over-500-view-has-a-sharp-edge",
    title: "the largest MRR comes first, and the MRR over 500 view holds 501 but neither 500 nor 499",
    entryPoint: "Customers › Workspaces",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const plans = [await createPlan(ctx, "p499", { price: 499, order: 1 }), await createPlan(ctx, "p500", { price: 500, order: 2 }), await createPlan(ctx, "p501", { price: 501, order: 3 })];
      for (const [index, plan] of plans.entries()) {
        const visitor = await register(ctx, `edge${index}`, { workspaceName: `Edge ${[499, 500, 501][index]}` });
        await put(ctx, visitor.tenantId, plan.id, "active");
      }
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/customers/workspaces");
      await ctx.verify("the largest MRR comes first", [tab.shows(/Edge 501[\s\S]*Edge 500[\s\S]*Edge 499/, { timeoutMs: 60_000 })]);
      await ctx.verify("the views carry their counts: MRR over 500 holds one workspace, the others none", [
        tab.visible({ role: "button", name: "MRR over 500 1" }, { timeoutMs: 30_000 }),
        tab.visible({ role: "button", name: "Past due for more than 7 days 0" }, { timeoutMs: 10_000 }),
        tab.visible({ role: "button", name: "Trials ending in 14 days 0" }, { timeoutMs: 10_000 }),
        tab.visible({ role: "button", name: "Owner never joined 0" }, { timeoutMs: 10_000 }),
        tab.visible({ role: "button", name: "Active 3" }, { timeoutMs: 10_000 }),
      ]);
      await tab.click({ role: "button", name: "MRR over 500 1" });
      await ctx.verify("MRR over 500 lists only the 501 workspace", [tab.shows(/Edge 501/, { timeoutMs: 30_000 }), tab.shows(/Edge 500|Edge 499/, { timeoutMs: 5_000, not: true })]);
    },
  },
  {
    id: "the-invoice-figures-count-the-right-statuses-and-periods",
    title: "awaiting payment, collected this month, credited this month and written off this year each read their own invoices",
    entryPoint: "GET /api/saas/billing-stats/invoices, /credit-notes",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const customer = await register(ctx, "billed");
      const id = customer.tenantId;
      await mirror(ctx, id, { number: "F-OPEN", documentType: "invoice", status: "open", totalMinor: 7000, daysAgo: 1 });
      await mirror(ctx, id, { number: "F-PAID", documentType: "invoice", status: "paid", totalMinor: 4900, daysAgo: 0 });
      await mirror(ctx, id, { number: "F-OLDPAID", documentType: "invoice", status: "paid", totalMinor: 2000, daysAgo: 400 });
      await mirror(ctx, id, { number: "F-UNC", documentType: "invoice", status: "uncollectible", totalMinor: 3000, daysAgo: 5 });
      await mirror(ctx, id, { number: "F-UNCOLD", documentType: "invoice", status: "uncollectible", totalMinor: 9000, daysAgo: 400 });
      await mirror(ctx, id, { number: "F-DRAFT", documentType: "invoice", status: "draft", totalMinor: 500, daysAgo: 0 });
      await fixture(ctx, "an issued credit to balance", "POST", "/credit-note", { tenantId: id, number: "N-1", amountMinor: 1500, status: "issued", type: "credit_to_balance", refunded: false });
      await fixture(ctx, "an issued refund", "POST", "/credit-note", { tenantId: id, number: "N-2", amountMinor: 2500, status: "issued", type: "refund", refunded: true });
      await fixture(ctx, "a void credit note", "POST", "/credit-note", { tenantId: id, number: "N-3", amountMinor: 9900, status: "void", type: "credit_to_balance", refunded: false });
      const figures = await saas(ctx, "the invoice figures", "GET", "/billing-stats/invoices");
      const byId = Object.fromEntries(list(figures.body, "items").map((entry) => [text(entry, "id"), entry]));
      const amount = (/** @type {string} */ key) => pick(byId[key], "value", "params", "value", "value");
      const count = (/** @type {string} */ key) => pick(byId[key], "detail", "params", "count", "value");
      await ctx.verify("each figure reads its own statuses and period", [
        check("awaiting payment: the open invoice, 70.00, count 1", amount("awaiting") === 7000 && count("awaiting") === 1, byId.awaiting),
        check("collected this month: only the paid invoice of this month, 49.00, count 1", amount("collected") === 4900 && count("collected") === 1, byId.collected),
        check("credited this month: the two issued notes, 40.00, count 2, a void one ignored", amount("credited") === 4000 && count("credited") === 2, byId.credited),
        check("written off this year: this year's uncollectible only, 30.00, count 1", amount("written_off") === 3000 && count("written_off") === 1, byId.written_off),
      ]);
      const split = await saas(ctx, "the credit note figures", "GET", "/billing-stats/credit-notes");
      const notes = Object.fromEntries(list(split.body, "items").map((entry) => [text(entry, "id"), entry]));
      await ctx.verify("the credit note figures split balance credits from card refunds", [
        check("credited: 40.00", pick(notes.credited, "value", "params", "value", "value") === 4000, notes.credited),
        check("refunded to cards: 25.00, count 1", pick(notes.refunded, "value", "params", "value", "value") === 2500 && pick(notes.refunded, "detail", "params", "count", "value") === 1, notes.refunded),
      ]);
    },
  },
  {
    id: "segment-money-columns-count-only-paying-workspaces-and-a-twelfth-of-a-yearly-price",
    title: "owned_mrr is 0 for a trial, a gift and a suspended workspace, and a yearly plan counts a twelfth of its price",
    entryPoint: "POST /api/saas/segments/:id/owners-export/start",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const yearly = await createPlan(ctx, "yearly", { price: 120, interval: "year", order: 1 });
      const monthly = await createPlan(ctx, "monthly", { price: 50, order: 2 });
      const cases = [
        { name: "mrr-yearly", plan: yearly.id, status: "active", gift: false, expected: "10.00" },
        { name: "mrr-monthly", plan: monthly.id, status: "active", gift: false, expected: "50.00" },
        { name: "mrr-trial", plan: monthly.id, status: "trialing", gift: false, expected: "0.00" },
        { name: "mrr-gift", plan: monthly.id, status: "active", gift: true, expected: "0.00" },
        { name: "mrr-suspended", plan: monthly.id, status: "suspended", gift: false, expected: "0.00" },
      ];
      /** @type {Record<string, string>} */
      const tenants = {};
      for (const entry of cases) {
        const visitor = await register(ctx, entry.name, { workspaceName: entry.name });
        tenants[entry.name] = visitor.email;
        await put(ctx, visitor.tenantId, entry.plan, entry.status, entry.gift);
      }
      const segment = await saas(ctx, "create the segment", "POST", "/segments", { body: { name: "MRR cases", conditions: { logical: "and", conditions: [{ field: "email", operator: "contains", value: "mrr-" }] } } });
      const started = await saas(ctx, "start the export", "POST", `/segments/${text(segment.body, "_id")}/owners-export/start`);
      const jobId = text(started.body, "jobId");
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await saas(ctx, "export status", "GET", `/segments/${text(segment.body, "_id")}/owners-export/status/${jobId}`);
        if (text(status.body, "status") === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const file = await saas(ctx, "download", "GET", `/segments/${text(segment.body, "_id")}/owners-export/download/${jobId}`);
      const rows = (isText(file.body) ? file.body : "").split("\r\n").slice(1).filter((line) => line !== "").map((line) => line.split(","));
      const mrrOf = (/** @type {string} */ email) => rows.find((row) => row[1] === email)?.[8];
      await ctx.verify("each workspace's owned_mrr", cases.map((entry) => check(`${entry.name}: ${entry.expected}`, mrrOf(tenants[entry.name]) === entry.expected, rows)));
    },
  },
  {
    id: "plans-by-mrr-ignores-trialing-workspaces-and-the-change-plan-list-fits-the-workspace",
    title: "a trialing workspace on a plan adds nothing to Plans by MRR, and the plans a workspace may switch to leave out those too small for its seats and those for the other audience",
    entryPoint: "GET /api/saas/dashboard/plans-by-mrr, GET /api/saas/tenant/plan",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0, permissions: await allPermissionIds(ctx) });
      const team = await createPlan(ctx, "team", { price: 50, order: 1, name: { en: "Team" }, permissions: await allPermissionIds(ctx) });
      await createPlan(ctx, "tiny", { price: 5, order: 2, maxMembers: 1, name: { en: "Tiny" } });
      await createPlan(ctx, "bizonly", { price: 9, order: 3, audience: "business", name: { en: "Bizonly" } });
      await createPlan(ctx, "roomy", { price: 7, order: 4, maxMembers: 10, name: { en: "Roomy" } });
      const paying = await register(ctx, "pays", { workspaceName: "Pays Co" });
      const trial = await register(ctx, "tries", { workspaceName: "Tries Co" });
      await put(ctx, paying.tenantId, team.id, "active");
      await put(ctx, trial.tenantId, team.id, "trialing");
      const byPlan = await saas(ctx, "plans by MRR", "GET", "/dashboard/plans-by-mrr");
      const rows = list(byPlan.body, "items");
      await ctx.verify("only the paying workspace counts", [
        check("one plan listed: Team", rows.length === 1 && text(rows[0], "title") === "Team", rows),
        check("MRR 50, one workspace", rows[0]?.value === 50 && pick(rows[0], "description", "params", "count", "value") === 1, rows),
      ]);
      const member = await joinMember(ctx, "pays", "second-seat");
      const options = await saas(ctx, "the plans the workspace may switch to", "GET", "/tenant/plan", { as: "pays" });
      const offered = list(options.body, "available");
      const named = (/** @type {string} */ name) => offered.find((entry) => text(entry, "name") === name);
      await ctx.verify("the Change plan list carries what the dialog filters on", [
        check("the second member joined", member.ok, member.email),
        check("two seats are in use", pick(options.body, "seats", "occupied") === 2, pick(options.body, "seats")),
        check("a one-member plan is smaller than the seats in use", named("Tiny")?.maxMembers === 1, named("Tiny")),
        check("a plan with room is large enough", named("Roomy")?.maxMembers === 10, named("Roomy")),
        check("a business plan is not offered to an individual workspace", named("Bizonly")?.isOfferedToCustomerType === false, named("Bizonly")),
        check("a plan for anyone is offered", named("Roomy")?.isOfferedToCustomerType === true, named("Roomy")),
      ]);
    },
  },
];
