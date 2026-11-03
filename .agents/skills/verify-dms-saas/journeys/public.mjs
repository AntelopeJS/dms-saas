import { guarded } from "../guard.mjs";
import { check, isText, pick, createPlan, list, register, saas, text, withConfig } from "../saas.mjs";

import { configJourneys } from "./parts/public-config.mjs";
import { moreJourneys } from "./parts/public-more.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const STRONG = "Passw0rd!x";

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
    id: "a-visitor-registers-onto-the-default-plan",
    title: "a registration opens a workspace on the free plan with a default or trimmed name, and refuses a taken e-mail",
    entryPoint: "POST /api/saas/register, GET /api/saas/tenant/plan, GET /api/saas/workspaces/current",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free", { name: { en: "Free" } });
      await ctx.verify("the platform owner publishes a free plan", [check("POST /plans answers 200", free.answer.status === 200 && free.id !== "", free.answer.body)], { critical: true });
      const named = await register(ctx, "named", { workspaceName: "  Acme Lab  " });
      const plain = await register(ctx, "plain");
      await ctx.verify("both registrations answer a user and a workspace", [
        check("named", named.answer.status === 200 && named.tenantId !== "" && named.userId !== "", named.answer.body),
        check("plain", plain.answer.status === 200 && plain.tenantId !== "" && plain.userId !== "", plain.answer.body),
        check("two different workspaces", named.tenantId !== plain.tenantId, `${named.tenantId} ${plain.tenantId}`),
      ], { critical: true });
      const namedCurrent = await saas(ctx, "the named workspace", "GET", "/workspaces/current", { as: "named" });
      const plainCurrent = await saas(ctx, "the default workspace", "GET", "/workspaces/current", { as: "plain" });
      await ctx.verify("the workspace name is trimmed, or the default", [
        check("a given name is saved trimmed", text(namedCurrent.body, "name") === "Acme Lab", namedCurrent.body),
        check("no name gives My workspace", text(plainCurrent.body, "name") === "My workspace", plainCurrent.body),
      ]);
      const plan = await saas(ctx, "the visitor's plan", "GET", "/tenant/plan", { as: "named" });
      await ctx.verify("the workspace is on the free plan, active, with one seat used", [
        check("the plan is the free plan", text(plan.body, "current", "_id") === free.id && text(plan.body, "current", "slug") === "free", plan.body),
        check("the status is active", text(plan.body, "status") === "active", plan.body),
        check("one member, no invitation", JSON.stringify(pick(plan.body, "seats")) === JSON.stringify({ members: 1, pendingInvites: 0, occupied: 1 }), plan.body),
      ]);
      const again = await saas(ctx, "register the same e-mail again", "POST", "/register", { as: "anon", body: { email: named.email, password: STRONG, name: "Again" } });
      await ctx.verify("a taken e-mail is refused", [check("400 saas.errors.user.email_in_use", again.status === 400 && code(again) === "saas.errors.user.email_in_use", again.body)]);
    },
  },
  {
    id: "the-password-policy-is-checked-before-anything-is-created",
    title: "a password outside the DMS policy is refused with 400 before the e-mail is looked up, and nothing is created",
    entryPoint: "POST /api/saas/register",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const email = ctx.email("policy");
      const cases = [
        ["seven characters", "Passw0r!"],
        ["no uppercase letter", "passw0rd!x"],
        ["no digit", "Password!x"],
        ["no special character", "Passw0rdxx"],
        ["a special character outside @$!%*?&", "Passw0rd#x"],
      ];
      const results = [];
      for (const [label, password] of cases) {
        const short = label === "seven characters" ? "Pass0r!" : password;
        const answer = await saas(ctx, `register with ${label}`, "POST", "/register", { as: "anon", body: { email, password: short, name: "Policy" } });
        results.push(check(`${label}: 400 saas.errors.registration.password_policy`, answer.status === 400 && code(answer) === "saas.errors.registration.password_policy", answer.body));
      }
      await ctx.verify("each rule of the policy is enforced", results);
      const eight = await saas(ctx, "register with exactly eight characters", "POST", "/register", { as: "anon", body: { email, password: "Passw0r!", name: "Policy" } });
      await ctx.verify("eight characters with every rule is accepted, so the earlier refusals created no account", [check("200", eight.status === 200, eight.body)]);
    },
  },
  {
    id: "registration-needs-a-free-plan-open-to-individuals",
    title: "without an active free plan open to individuals registration answers 409, with it the lowest order wins",
    entryPoint: "POST /api/saas/register",
    async run(/** @type {Ctx} */ ctx) {
      const refused = async (/** @type {string} */ label) => {
        const answer = await saas(ctx, label, "POST", "/register", { as: "anon", body: { email: ctx.email(label.slice(0, 20)), password: STRONG, name: "Plan" } });
        return check(`${label}: 409 saas.errors.plan.no_free_plan`, answer.status === 409 && code(answer) === "saas.errors.plan.no_free_plan", answer.body);
      };
      await ctx.verify("an empty catalogue refuses", [await refused("empty catalogue")]);
      const paid = await createPlan(ctx, "paid", { price: 9 });
      await ctx.verify("a paid plan is not a default plan", [paid.id === "" ? check("the paid plan is saved", false, paid.answer.body) : await refused("only a paid plan")]);
      const business = await createPlan(ctx, "biz-free", { audience: "business" });
      await ctx.verify("a free plan for businesses only is not a default plan", [business.id === "" ? check("saved", false, business.answer.body) : await refused("only a business free plan")]);
      const inactive = await createPlan(ctx, "off-free", { isActive: false });
      await ctx.verify("an inactive free plan is not a default plan", [inactive.id === "" ? check("saved", false, inactive.answer.body) : await refused("only an inactive free plan")]);
      const second = await createPlan(ctx, "second-free", { order: 5 });
      const first = await createPlan(ctx, "first-free", { order: 2 });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const named = await saas(ctx, "the plan registration opens on", "GET", "/register/plan", { as: "anon" });
        if (text(named.body, "plan", "_id") === first.id) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const visitor = await register(ctx, "ordered");
      const plan = await saas(ctx, "the visitor's plan", "GET", "/tenant/plan", { as: "ordered" });
      await ctx.verify("the individual free plan with the lowest order is attached", [
        check("registration answers 200", visitor.answer.status === 200, visitor.answer.body),
        check("first-free, not second-free", text(plan.body, "current", "_id") === first.id && first.id !== second.id, plan.body),
      ]);
    },
  },
  {
    id: "the-card-step-follows-the-payment-method-option",
    title: "required asks for a card, optional and none do not, and a deployment without a usable Stripe key applies none",
    entryPoint: "POST /api/saas/register, GET /api/saas/register/setup-intent",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const intent = async (/** @type {string} */ label) => saas(ctx, label, "GET", "/register/setup-intent", { as: "anon" });
      for (const mode of ["required", "optional", "none"]) {
        await withConfig(ctx, { VERIFY_SAAS_PAYMENT_METHOD: mode }, async () => {
          const answer = await intent(`setup intent under ${mode} with a placeholder key`);
          const visitor = await register(ctx, `placeholder-${mode}`);
          await ctx.verify(`${mode} with a placeholder key behaves as none`, [
            check("the setup intent answers 400 saas.errors.registration.payment_method_disabled", answer.status === 400 && code(answer) === "saas.errors.registration.payment_method_disabled", answer.body),
            check("registration lands on the free plan without a card", visitor.answer.status === 200, visitor.answer.body),
          ]);
        });
      }
      await withConfig(ctx, { VERIFY_SAAS_PAYMENT_METHOD: "required", VERIFY_SAAS_STRIPE_SECRET_KEY: "sk_test_verifysaaslocal" }, async () => {
        const answer = await saas(ctx, "register without a card under required", "POST", "/register", { as: "anon", body: { email: ctx.email("needs-card"), password: STRONG, name: "Card" } });
        await ctx.verify("required with a usable key refuses a registration without a card before any Stripe call", [
          check("400 saas.errors.registration.payment_method_required", answer.status === 400 && code(answer) === "saas.errors.registration.payment_method_required", answer.body),
        ]);
      });
      await withConfig(ctx, { VERIFY_SAAS_PAYMENT_METHOD: "none", VERIFY_SAAS_STRIPE_SECRET_KEY: "sk_test_verifysaaslocal" }, async () => {
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
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const open = await register(ctx, "while-open");
      await ctx.verify("open admission registers", [check("200", open.answer.status === 200, open.answer.body)]);
      await withConfig(ctx, { VERIFY_SAAS_ADMISSION: "invitation-only" }, async () => {
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
  ...configJourneys,
]);
