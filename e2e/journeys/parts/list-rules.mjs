import { check, createPlan, fixture, register, saas } from "../../saas.mjs";

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

/** The back-office workspace list: its ordering and its views. */
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
    id: "the-past-due-view-needs-more-than-7-days-and-an-operator-created-workspace-has-an-owner-who-never-joined",
    title: "a workspace past due for 8 days is in the Past due for more than 7 days view and one for 6 days is not, and a workspace an operator created for an unknown e-mail counts under Owner never joined",
    entryPoint: "Customers › Workspaces, POST /api/saas/workspaces/create",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const fresh = await register(ctx, "late-six", { workspaceName: "Late Six" });
      const old = await register(ctx, "late-eight", { workspaceName: "Late Eight" });
      await put(ctx, fresh.tenantId, pro.id, "past_due");
      await put(ctx, old.tenantId, pro.id, "past_due");
      await fixture(ctx, "age the six-day workspace", "POST", "/age-state", { tenantId: fresh.tenantId, daysAgo: 6 });
      await fixture(ctx, "age the eight-day workspace", "POST", "/age-state", { tenantId: old.tenantId, daysAgo: 8 });
      const created = await saas(ctx, "create a workspace for an owner who never joined", "POST", "/workspaces/create", { body: { name: "Waiting Co", planId: pro.id, ownerEmail: ctx.email("waiting-owner"), access: "complimentary", freeUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() } });
      const noName = await saas(ctx, "create without a name", "POST", "/workspaces/create", { body: { planId: pro.id, ownerEmail: ctx.email("x"), access: "complimentary" } });
      const noPlan = await saas(ctx, "create without a plan", "POST", "/workspaces/create", { body: { name: "No Plan", ownerEmail: ctx.email("x"), access: "complimentary" } });
      const noOwner = await saas(ctx, "create without an owner e-mail", "POST", "/workspaces/create", { body: { name: "No Owner", planId: pro.id, access: "complimentary" } });
      const noAccess = await saas(ctx, "create without an access model", "POST", "/workspaces/create", { body: { name: "No Access", planId: pro.id, ownerEmail: ctx.email("x") } });
      const pastDate = await saas(ctx, "create with a past end date", "POST", "/workspaces/create", { body: { name: "Past", planId: pro.id, ownerEmail: ctx.email("x"), access: "complimentary", freeUntil: "2020-01-01T00:00:00Z" } });
      await ctx.verify("the operator form is validated field by field", [
        check("created", created.status === 200, created.body),
        check("no name: 400 saas.errors.workspace_create.name", noName.status === 400 && JSON.stringify(noName.body) === JSON.stringify("saas.errors.workspace_create.name"), noName.body),
        check("no plan: 400 saas.errors.workspace_create.plan", noPlan.status === 400 && JSON.stringify(noPlan.body) === JSON.stringify("saas.errors.workspace_create.plan"), noPlan.body),
        check("no owner: 400 saas.errors.workspace_create.owner_email", noOwner.status === 400 && JSON.stringify(noOwner.body) === JSON.stringify("saas.errors.workspace_create.owner_email"), noOwner.body),
        check("no access: 400 saas.errors.workspace_create.access", noAccess.status === 400 && JSON.stringify(noAccess.body) === JSON.stringify("saas.errors.workspace_create.access"), noAccess.body),
        check("past end date: 400 saas.errors.workspace_create.free_until_past", pastDate.status === 400 && JSON.stringify(pastDate.body) === JSON.stringify("saas.errors.workspace_create.free_until_past"), pastDate.body),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/customers/workspaces");
      await ctx.verify("the views count them", [
        tab.visible({ role: "button", name: "Past due for more than 7 days 1" }, { timeoutMs: 60_000 }),
        tab.visible({ role: "button", name: "Owner never joined 1" }, { timeoutMs: 10_000 }),
        tab.visible({ role: "button", name: "Past due 2" }, { timeoutMs: 10_000 }),
      ]);
      await tab.click({ role: "button", name: "Past due for more than 7 days 1" });
      await ctx.verify("Past due for more than 7 days lists only the eight-day workspace", [tab.shows(/Late Eight/, { timeoutMs: 30_000 }), tab.shows(/Late Six/, { timeoutMs: 5_000, not: true })]);
      await tab.click({ role: "button", name: "Owner never joined 1" });
      await ctx.verify("Owner never joined lists the created workspace", [tab.shows(/Waiting Co/, { timeoutMs: 30_000 })]);
    },
  },
];
