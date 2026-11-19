import { waitForHydration } from "../../guard.mjs";
import { allPermissionIds, check, createPlan, list, pick, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/** The extras, sign-in completion and pricing journeys of the public feature. */
export const moreJourneys = [
  {
    id: "a-visitor-registers-through-the-form-and-signs-in-to-the-new-workspace",
    title: "a visitor fills in /register without a card, is sent to sign in, signs in with the new account and finds a workspace named after them on the free plan",
    entryPoint: "/register, POST /api/saas/register, /auth, Settings › Workspace › General",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free", { name: { en: "Free" }, permissions: await allPermissionIds(ctx) });
      await ctx.verify("a free plan is published", [check("POST /plans answers 200", free.answer.status === 200 && free.id !== "", free.answer.body)], { critical: true });
      const email = ctx.email("form-visitor");
      const password = ctx.password();
      const tab = await ctx.tab("anon", "register form");
      await tab.goto("/register");
      await ctx.verify("the register form is drawn and is interactive", [
        tab.shows(/Create your account/, { timeoutMs: 60_000 }),
        check("the form hydrated", await waitForHydration(tab), "the Show password toggle answers"),
      ], { critical: true });
      await ctx.verify("the register form has no card step", [tab.shows(/Saved securely by Stripe/, { not: true })], { critical: true });
      await tab.fill({ role: "textbox", name: "Full name" }, "Form Visitor");
      await tab.fill({ role: "textbox", name: "Email", exact: true }, email);
      await tab.fill({ role: "textbox", name: "Password", exact: true }, password);
      await tab.check({ role: "checkbox", name: /I accept the Terms and conditions/ });
      await tab.click({ role: "button", name: "Create my account" });
      await ctx.verify("the submitted form sends the visitor to sign in", [tab.at(/^\/auth/, { timeoutMs: 60_000 })], { critical: true });
      ctx.addAccount("form-visitor", { email, password });
      const mine = await saas(ctx, "the workspaces of the new account", "GET", "/workspaces/mine", { as: "form-visitor" });
      const plan = await saas(ctx, "the plan of the new workspace", "GET", "/tenant/plan", { as: "form-visitor" });
      await ctx.verify("the account owns one workspace named after the visitor, on the free plan", [
        check("one workspace, Form Visitor's workspace, owned", list(mine.body).length === 1 && text(list(mine.body)[0], "name") === "Form Visitor's workspace" && pick(list(mine.body)[0], "isOwner") === true, mine.body),
        check("the plan is the free plan", text(plan.body, "current", "_id") === free.id, plan.body),
        check("it is active", text(plan.body, "status") === "active", plan.body),
      ]);
      await tab.signIn("form-visitor");
      await tab.goto("/settings/workspace/general");
      await ctx.verify("the signed-in visitor sees the new workspace and its plan", [
        tab.shows(/Form Visitor's workspace/, { timeoutMs: 60_000 }),
        tab.visible({ role: "link", name: /^Plan Free/ }, { timeoutMs: 15_000 }),
        tab.visible({ role: "button", name: "Form Visitor" }, { timeoutMs: 15_000 }),
      ]);
    },
  },
  {
    id: "pricing-lists-plans-in-catalogue-order-with-the-documented-call-to-action",
    title: "/pricing orders plans by catalogue order whatever their price, and each card says Start free, Start N-day trial or Choose followed by the plan name",
    entryPoint: "GET /api/saas/pricing, /pricing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "starter", { order: 0, name: { en: "Starter" } });
      await createPlan(ctx, "premium", { order: 1, price: 20, name: { en: "Premium" } });
      await createPlan(ctx, "trialed", { order: 2, price: 9, trialDays: 14, name: { en: "Trialed" } });
      await createPlan(ctx, "basic", { order: 3, price: 5, name: { en: "Basic" } });
      const api = await saas(ctx, "the public catalogue", "GET", "/pricing", { as: "anon" });
      await ctx.verify("the catalogue follows the order, not the price", [check("Starter, Premium, Trialed, Basic", JSON.stringify(list(api.body, "plans").map((plan) => text(plan, "slug"))) === JSON.stringify(["starter", "premium", "trialed", "basic"]), api.body)]);
      const tab = await ctx.tab("anon");
      await tab.goto("/pricing");
      await ctx.verify("the page shows the cards in that order with their calls to action", [
        tab.shows(/Starter[\s\S]*Premium[\s\S]*Trialed[\s\S]*Basic/, { timeoutMs: 60_000 }),
        tab.shows(/Start free/, { timeoutMs: 10_000 }),
        tab.shows(/Start 14-day trial/, { timeoutMs: 10_000 }),
        tab.shows(/Choose Premium/, { timeoutMs: 10_000 }),
        tab.shows(/Choose Basic/, { timeoutMs: 10_000 }),
      ]);
    },
  },
];
