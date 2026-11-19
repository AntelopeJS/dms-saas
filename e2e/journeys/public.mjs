import { guarded } from "../guard.mjs";
import { passwordWith, check, isText, createPlan, list, register, saas, text, withConfig } from "../saas.mjs";

import { moreJourneys } from "./parts/public-more.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const STRONG = passwordWith();

/**
 * @param {import("../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code the module answers
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/** Public registration, the options that shape it, the pricing catalogue and the legal pages. */
export const journeys = guarded([
  {
    id: "the-card-step-follows-the-payment-method-option",
    title: "required asks for a card, optional and none do not, and a deployment without a usable Stripe key applies none",
    entryPoint: "POST /api/saas/register, GET /api/saas/register/setup-intent",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const intent = async (/** @type {string} */ label) => saas(ctx, label, "GET", "/register/setup-intent", { as: "anon" });
      for (const mode of ["required", "optional", "none"]) {
        await withConfig(ctx, { E2E_SAAS_PAYMENT_METHOD: mode }, async () => {
          const answer = await intent(`setup intent under ${mode} with a placeholder key`);
          const visitor = await register(ctx, `placeholder-${mode}`);
          await ctx.verify(`${mode} with a placeholder key behaves as none`, [
            check("the setup intent answers 400 saas.errors.registration.payment_method_disabled", answer.status === 400 && code(answer) === "saas.errors.registration.payment_method_disabled", answer.body),
            check("registration lands on the free plan without a card", visitor.answer.status === 200, visitor.answer.body),
          ]);
          const tab = await ctx.tab("anon", `register under ${mode}`);
          await tab.goto("/register");
          const form = await tab.shows(/Full name/, { timeoutMs: 30_000 });
          const noCard = await tab.shows(/Saved securely by Stripe/, { not: true });
          await ctx.verify(`${mode} with a placeholder key draws the register screen without its card step`, [form, noCard]);
        });
      }
      await withConfig(ctx, { E2E_SAAS_PAYMENT_METHOD: "required", E2E_SAAS_STRIPE_SECRET_KEY: "sk_test_verifysaaslocal" }, async () => {
        const answer = await saas(ctx, "register without a card under required", "POST", "/register", { as: "anon", body: { email: ctx.email("needs-card"), password: STRONG, name: "Card" } });
        await ctx.verify("required with a usable key refuses a registration without a card before any Stripe call", [
          check("400 saas.errors.registration.payment_method_required", answer.status === 400 && code(answer) === "saas.errors.registration.payment_method_required", answer.body),
        ]);
      });
      await withConfig(ctx, { E2E_SAAS_PAYMENT_METHOD: "none", E2E_SAAS_STRIPE_SECRET_KEY: "sk_test_verifysaaslocal" }, async () => {
        const answer = await intent("setup intent under none with a usable key");
        const visitor = await register(ctx, "none-usable");
        await ctx.verify("none with a usable key shows no card step and ignores a card sent anyway", [
          check("the setup intent answers 400 saas.errors.registration.payment_method_disabled", answer.status === 400 && code(answer) === "saas.errors.registration.payment_method_disabled", answer.body),
          check("registration lands on the free plan", visitor.answer.status === 200, visitor.answer.body),
        ]);
        const withCard = await saas(ctx, "register with a card under none", "POST", "/register", { as: "anon", body: { email: ctx.email("card-ignored"), password: STRONG, name: "Card", paymentMethodId: "pm_ignored" } });
        await ctx.verify("a card sent under none is ignored", [check("200", withCard.status === 200, withCard.body)]);
      });
    },
  },
  {
    id: "invitation-only-closes-every-registration-route",
    title: "invitation-only answers 403 saas.errors.registration_closed on every register route and leaves pricing open",
    entryPoint: "/api/saas/register/*, /api/saas/pricing, /register, /auth",
    knownFailures: {
      "page shows /Registration is closed/": "after a backend restart into invitation-only, /register renders the 500 page (\"The core error.500.description translation must be loaded\") instead of the closed screen",
      'link "Sign in" is visible': "after a backend restart into invitation-only, /register renders the 500 page (\"The core error.500.description translation must be loaded\") instead of the closed screen",
    },
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const open = await register(ctx, "while-open");
      await ctx.verify("open admission registers", [check("200", open.answer.status === 200, open.answer.body)]);
      await withConfig(ctx, { E2E_SAAS_ADMISSION: "invitation-only" }, async () => {
        const body = { email: ctx.email("closed"), password: STRONG, name: "Closed" };
        /** @type {{ method: string, path: string, payload: unknown }[]} */
        const routes = [
          { method: "POST", path: "/register", payload: body },
          { method: "GET", path: "/register/plan", payload: undefined },
          { method: "GET", path: "/register/setup-intent", payload: undefined },
          { method: "POST", path: "/register/pending", payload: { tenant_assignment_token: "x" } },
          { method: "POST", path: "/register/finalize", payload: { tenant_assignment_token: "x" } },
        ];
        const checks = [];
        for (const { method, path, payload } of routes) {
          const answer = await saas(ctx, `${method} ${path} while closed`, method, path, { as: "anon", body: payload });
          checks.push(check(`${method} ${path}: 403 saas.errors.registration_closed`, answer.status === 403 && code(answer) === "saas.errors.registration_closed", answer.body));
        }
        await ctx.verify("every register route is closed", checks);
        const options = await saas(ctx, "an owner reads the workspace creation options", "GET", "/workspaces/create-options", { as: "while-open" });
        const adminOptions = await saas(ctx, "the platform admin reads the workspace creation options", "GET", "/workspaces/create-options");
        await ctx.verify("creating a workspace in the app is closed to everyone but a platform owner", [
          check("a workspace owner: 403 saas.errors.registration_closed", options.status === 403 && code(options) === "saas.errors.registration_closed", options.body),
          check("the platform admin: 200", adminOptions.status === 200, adminOptions.body),
        ]);
        const pricing = await saas(ctx, "pricing while closed", "GET", "/pricing", { as: "anon" });
        await ctx.verify("pricing stays open", [check("200 with the free plan", pricing.status === 200 && list(pricing.body, "plans").length === 1, pricing.body)]);
        const tab = await ctx.tab("anon");
        await tab.goto("/register");
        await ctx.verify("the register screen says registration is closed and offers Sign in", [
          tab.shows(/Registration is closed/, { timeoutMs: 30_000 }),
          tab.visible({ role: "link", name: "Sign in" }, { timeoutMs: 15_000 }),
        ]);
      });
      const reopened = await register(ctx, "reopened");
      await ctx.verify("registration works again once admission is open", [check("200", reopened.answer.status === 200, reopened.answer.body)]);
    },
  },
  ...moreJourneys,
]);
