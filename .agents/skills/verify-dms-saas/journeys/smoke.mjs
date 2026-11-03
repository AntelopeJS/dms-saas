import { guarded } from "../guard.mjs";
import { check, list, saas, register, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/** The installation's "Start with one free workspace": a visitor registers and lands on the free plan. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "a visitor registers without a card, lands in a workspace on the free plan, and sees that plan on the Billing page",
    entryPoint: "/register, POST /api/saas/register, Settings › Workspace › Billing",
    async run(/** @type {Ctx} */ ctx) {
      const created = await saas(ctx, "publish the free plan", "POST", "/plans", {
        body: { name: { en: "Free" }, slug: "free", price: 0, currency: "EUR", interval: "month", audience: "any", isPublic: true, isActive: true, order: 0 },
      });
      await ctx.verify("the platform owner publishes a free plan", [check("POST /plans answers 200", created.status === 200, created.body)], { critical: true });
      const visitor = await register(ctx, "visitor");
      await ctx.verify("the visitor registers", [
        check("POST /register answers a workspace and a user", visitor.answer.status === 200 && visitor.tenantId !== "" && visitor.userId !== "", visitor.answer.body),
      ], { critical: true });
      const plans = await saas(ctx, "the catalogue", "GET", "/plans");
      await ctx.verify("the free plan is in the catalogue", [check("one plan named Free", list(plans.body).some((plan) => text(plan, "slug") === "free"), plans.body)]);
    },
  },
]);
