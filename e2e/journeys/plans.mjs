import { guarded } from "../guard.mjs";
import { check, createPlan, list, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/** Catalogue › Plans, in the browser. */
export const journeys = guarded([
  {
    id: "the-platform-owner-creates-a-plan-in-the-editor-and-the-catalogue-lists-it",
    title: "the platform owner fills in the plan editor, the Plans page and the catalogue API list the new plan, and the public pricing page offers it",
    entryPoint: "Modules › SaaS › Catalogue › Plans, POST /api/saas/plans, GET /api/saas/plans, GET /api/saas/pricing, /pricing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { name: { en: "Free" } });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/catalog/plans");
      await ctx.verify("the Plans page lists the free plan and offers Create plan", [tab.visible({ role: "article", name: "Free" }, { timeoutMs: 60_000 }), tab.visible({ role: "link", name: "Create plan" }, { timeoutMs: 15_000 })], { critical: true });
      await tab.click({ role: "link", name: "Create plan" });
      await ctx.verify("the editor opens", [tab.shows(/A new subscription plan/, { timeoutMs: 60_000 })], { critical: true });
      await tab.fill({ role: "textbox", name: "Name", exact: true }, "Team Plan");
      await tab.fill({ role: "spinbutton", name: "Price excl. tax" }, "12");
      await tab.click({ role: "button", name: "Create plan" });
      await ctx.verify("saving opens the new plan's edit page", [tab.at(/\/modules\/saas\/catalog\/plans\/[^/]+\/edit$/, { timeoutMs: 60_000 })], { critical: true });
      const created = new URL(tab.page.url()).pathname.split("/").at(-2) ?? "";
      const catalogue = await saas(ctx, "the plans of the catalogue", "GET", "/plans");
      const stored = list(catalogue.body).find((plan) => text(plan, "_id") === created);
      const pricing = await saas(ctx, "the public pricing catalogue", "GET", "/pricing", { as: "anon" });
      await ctx.verify("the catalogue holds the plan as the editor sent it, and the public catalogue lists it after the free plan", [
        check("the catalogue lists it by the id of the edit page", stored !== undefined, catalogue.body),
        check("team-plan, 12 EUR a month, flat, on sale and public", stored !== undefined && text(stored, "slug") === "team-plan" && stored.price === 12 && text(stored, "currency") === "EUR" && text(stored, "interval") === "month" && text(stored, "billingMode") === "flat" && stored.isActive === true && stored.isPublic === true, stored),
        check("it comes after the free plan", JSON.stringify(list(catalogue.body).map((plan) => text(plan, "slug"))) === JSON.stringify(["free", "team-plan"]), catalogue.body),
        check("the pricing catalogue lists free then team-plan", JSON.stringify(list(pricing.body, "plans").map((plan) => text(plan, "slug"))) === JSON.stringify(["free", "team-plan"]), pricing.body),
      ]);
      await tab.goto("/modules/saas/catalog/plans");
      await ctx.verify("the Plans page lists both plans", [tab.visible({ role: "article", name: "Team Plan" }, { timeoutMs: 60_000 }), tab.visible({ role: "article", name: "Free" }, { timeoutMs: 15_000 })]);
      const visitor = await ctx.tab("anon", "pricing visitor");
      await visitor.goto("/pricing");
      await ctx.verify("the pricing page offers the new plan", [visitor.shows(/Team Plan[\s\S]*€12/, { timeoutMs: 60_000 }), visitor.visible({ role: "link", name: "Choose Team Plan" }, { timeoutMs: 15_000 })]);
    },
  },
]);
