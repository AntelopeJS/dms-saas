import { check, createPlan, list, pageHtml, refusedAtStart, saas, text, withConfig } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/** The options that decide what the module serves: start-time refusals, the default plan slug and the public screens. */
export const configJourneys = [
  {
    id: "a-wrong-option-stops-the-module-at-start",
    title: "an admission mode, a registration payment method or a preview cache lifetime outside the documented values stops the backend at start, and the boundary values start",
    entryPoint: "antelope.config.ts, module config of dms-saas",
    async run(/** @type {Ctx} */ ctx) {
      const admission = await refusedAtStart(ctx, { VERIFY_SAAS_ADMISSION: "closed" });
      const method = await refusedAtStart(ctx, { VERIFY_SAAS_PAYMENT_METHOD: "sometimes" });
      const negative = await refusedAtStart(ctx, { VERIFY_SAAS_PREVIEW_TTL: "-1" });
      await ctx.verify("a value outside the documented set stops the module", [
        check("admissionMode other than open and invitation-only", !admission.started, admission.failure),
        check("registration.paymentMethod other than required, optional and none", !method.started, method.failure),
        check("a negative upcomingInvoicePreviewCacheTtlSeconds", !negative.started, negative.failure),
      ]);
      const zero = await refusedAtStart(ctx, { VERIFY_SAAS_PREVIEW_TTL: "0" });
      const open = await refusedAtStart(ctx, { VERIFY_SAAS_ADMISSION: "open" });
      const invitation = await refusedAtStart(ctx, { VERIFY_SAAS_ADMISSION: "invitation-only", VERIFY_SAAS_PAYMENT_METHOD: "optional" });
      await ctx.verify("the documented values start", [
        check("a lifetime of 0 (price every request) starts", zero.started, zero.failure),
        check("open starts", open.started, open.failure),
        check("invitation-only with optional starts", invitation.started, invitation.failure),
      ]);
    },
  },
  {
    id: "a-default-plan-slug-picks-among-the-free-plans",
    title: "defaultPlanSlug picks a usable free plan, and a slug naming none is ignored in favour of the lowest-ordered free plan",
    entryPoint: "option defaultPlanSlug, GET /api/saas/register/plan",
    async run(/** @type {Ctx} */ ctx) {
      const first = await createPlan(ctx, "first", { order: 0 });
      const second = await createPlan(ctx, "second", { order: 1 });
      await createPlan(ctx, "paid", { order: 2, price: 10 });
      const opensOn = async (/** @type {string} */ label) => text((await saas(ctx, label, "GET", "/register/plan", { as: "anon" })).body, "plan", "_id");
      const unset = await opensOn("the plan without defaultPlanSlug");
      await withConfig(ctx, { VERIFY_SAAS_DEFAULT_PLAN: "second" }, async () => {
        const picked = await opensOn("the plan with defaultPlanSlug second");
        await ctx.verify("a slug naming a free plan picks it", [check("second, not the lowest order", picked === second.id, picked)]);
      });
      await withConfig(ctx, { VERIFY_SAAS_DEFAULT_PLAN: "ghost" }, async () => {
        const ghost = await opensOn("the plan with a slug naming nothing");
        await ctx.verify("a slug naming no plan is ignored", [check("the lowest-ordered free plan", ghost === first.id, ghost)]);
      });
      await withConfig(ctx, { VERIFY_SAAS_DEFAULT_PLAN: "paid" }, async () => {
        const paid = await opensOn("the plan with a slug naming a paid plan");
        await ctx.verify("a paid plan cannot be the default", [check("the lowest-ordered free plan", paid === first.id, paid)]);
      });
      await ctx.verify("without the option the lowest order wins", [check("first", unset === first.id, unset)]);
    },
  },
  {
    id: "a-screen-switched-off-frees-its-slug",
    title: "publicScreens.register false and publicScreens.pricing false stop the module serving those pages, and the public catalogue API stays",
    entryPoint: "option publicScreens, /register, /pricing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const served = async (/** @type {string} */ path, /** @type {RegExp} */ title) => title.test(await pageHtml(ctx, path));
      const REGISTER = /<title>Create your account/;
      const PRICING = /<title>Pricing/;
      await ctx.verify("by default both screens are served", [check("/register", await served("/register", REGISTER), "/register"), check("/pricing", await served("/pricing", PRICING), "/pricing")]);
      await withConfig(ctx, { VERIFY_SAAS_SCREENS_OFF: "register" }, async () => {
        await ctx.verify("register off: only pricing remains", [
          check("/register is not the module's page", !(await served("/register", REGISTER)), "/register"),
          check("/pricing is still served", await served("/pricing", PRICING), "/pricing"),
        ]);
      });
      await withConfig(ctx, { VERIFY_SAAS_SCREENS_OFF: "pricing" }, async () => {
        const catalogue = await saas(ctx, "the pricing API while the page is off", "GET", "/pricing", { as: "anon" });
        await ctx.verify("pricing off: the page goes, the catalogue API a replacement screen builds on stays", [
          check("/pricing is not the module's page", !(await served("/pricing", PRICING)), "/pricing"),
          check("/register is still served", await served("/register", REGISTER), "/register"),
          check("GET /api/saas/pricing still lists the plan", catalogue.status === 200 && list(catalogue.body, "plans").length === 1, catalogue.body),
        ]);
      });
    },
  },
  {
    id: "a-plan-saved-without-a-billing-mode-keeps-the-pricing-page-up",
    title: "the pricing page renders a public plan that was saved through the API without a billing mode (known finding: it answers 500)",
    entryPoint: "POST /api/saas/plans, /pricing",
    async run(/** @type {Ctx} */ ctx) {
      const plan = await saas(ctx, "save a plan without billingMode", "POST", "/plans", { body: { name: { en: "Free" }, slug: "free", price: 0, currency: "EUR", interval: "month", audience: "any", isPublic: true, isActive: true, order: 0 } });
      await ctx.verify("the plan is saved", [check("200", plan.status === 200, plan.body)], { critical: true });
      const html = await pageHtml(ctx, "/pricing");
      const api = await saas(ctx, "the catalogue API", "GET", "/pricing", { as: "anon" });
      await ctx.verify("the page and the API both serve the plan", [
        check("GET /api/saas/pricing lists it", list(api.body, "plans").length === 1, api.body),
        check("the pricing page is rendered, not the server error", /<title>Pricing/.test(html), html.slice(0, 120)),
      ]);
    },
  },
];
