import { guarded } from "../guard.mjs";
import { check, createPlan, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/** The installation's "Start with one free workspace": a visitor registers and sees the free plan on the Billing page. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "a visitor registers without a card, lands in a workspace on the free plan, and sees that plan on the Billing page",
    entryPoint: "/register, POST /api/saas/register, Settings › Workspace › Billing",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free", { name: { en: "Free" } });
      await ctx.verify("the platform owner publishes a free plan", [check("POST /plans answers 200", free.answer.status === 200 && free.id !== "", free.answer.body)], { critical: true });
      const visitor = await register(ctx, "visitor");
      await ctx.verify("the visitor registers", [check("POST /register answers a workspace and a user", visitor.answer.status === 200 && visitor.tenantId !== "" && visitor.userId !== "", visitor.answer.body)], { critical: true });
      const plan = await saas(ctx, "the visitor's plan", "GET", "/tenant/plan", { as: "visitor" });
      await ctx.verify("the workspace is on the free plan", [
        check("the plan is the free plan", text(plan.body, "current", "_id") === free.id, plan.body),
        check("it is active", text(plan.body, "status") === "active", plan.body),
      ]);
      const tab = await ctx.tab("visitor");
      await tab.signIn("visitor");
      await tab.goto("/settings/workspace/billing");
      await ctx.verify("the Billing page shows the free plan", [tab.shows(/Free/, { timeoutMs: 60_000 })]);
    },
  },
]);
