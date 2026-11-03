import { check, createPlan, fixture, isText, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const STRONG = "Passw0rd!x";

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code the module answers
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {unknown} value A JSON answer
 * @param {string} field A field name
 * @returns {boolean} Whether the field is null
 */
function pickNull(value, field) {
  return pick(value, field) === null;
}


/** The extras, sign-in completion and pricing journeys of the public feature. */
export const moreJourneys = [
  {
    id: "extras-reach-the-provisioning-listeners-within-their-limits",
    title: "registration extras are forwarded verbatim to TENANT_BEING_PROVISIONED listeners and bounded to 4096 bytes, 64 keys and depth 4",
    entryPoint: "POST /api/saas/register, Hook.TENANT_BEING_PROVISIONED",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const extras = { referral: "launch-week", teamSize: 4, nested: { a: ["x"] } };
      const visitor = await register(ctx, "extras", { extras });
      const seen = await fixture(ctx, "the recorded provisioning payloads", "GET", "/provisioned");
      const mine = list(seen.body).find((entry) => text(entry, "tenantId") === visitor.tenantId);
      await ctx.verify("the listener received the extras verbatim, with the new user", [
        check("registration answers 200", visitor.answer.status === 200, visitor.answer.body),
        check("extras equal what was sent", JSON.stringify(mine?.extras) === JSON.stringify(extras), mine),
        check("userId is the new user", mine !== undefined && text(mine, "userId") === visitor.userId, mine),
      ]);
      const attempt = async (/** @type {string} */ label, /** @type {unknown} */ payload, /** @type {number} */ status, /** @type {string} */ error) => {
        const answer = await saas(ctx, label, "POST", "/register", { as: "anon", body: { email: ctx.email(label.slice(0, 18)), password: STRONG, name: "Extras", extras: payload } });
        return check(`${label}: ${status}${error ? ` ${error}` : ""}`, answer.status === status && (!error || code(answer) === error), answer.body);
      };
      const keys = (/** @type {number} */ n) => Object.fromEntries(Array.from({ length: n }, (_, index) => [`k${index}`, 1]));
      /** @type {(levels: number) => unknown} */
      const deep = (levels) => (levels === 0 ? 1 : { d: deep(levels - 1) });
      const padded = (/** @type {number} */ bytes) => ({ s: "x".repeat(bytes - '{"s":""}'.length) });
      await ctx.verify("the key count is bounded at 64", [
        await attempt("64 keys", keys(64), 200, ""),
        await attempt("65 keys", keys(65), 400, "saas.errors.registration.extras_too_complex"),
      ]);
      await ctx.verify("the depth is bounded at 4", [
        await attempt("depth 4", deep(4), 200, ""),
        await attempt("depth 5", deep(5), 400, "saas.errors.registration.extras_too_complex"),
      ]);
      await ctx.verify("the size is bounded at 4096 bytes", [
        await attempt("4096 bytes", padded(4096), 200, ""),
        await attempt("4097 bytes", padded(4097), 400, "saas.errors.registration.extras_too_large"),
      ]);
      await ctx.verify("a non-object and a prototype key are refused", [
        await attempt("a string", "text", 400, "saas.errors.registration.extras_invalid"),
        await attempt("an array", [1], 400, "saas.errors.registration.extras_invalid"),
        await attempt("a constructor key", { constructor: 1 }, 400, "saas.errors.registration.extras_invalid"),
      ]);
    },
  },
  {
    id: "a-sign-in-without-a-workspace-is-completed",
    title: "an account with no workspace is described, then finalized into a workspace and a session, once",
    entryPoint: "POST /api/saas/register/pending, POST /api/saas/register/finalize",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free");
      const account = await fixture(ctx, "an account without a workspace", "POST", "/account-without-workspace", { email: ctx.email("orphan"), name: "Orphan", password: STRONG });
      const token = text(account.body, "token");
      await ctx.verify("the fixture made an account and a token", [check("token", token !== "", account.body)], { critical: true });
      const pending = await saas(ctx, "describe the pending registration", "POST", "/register/pending", { as: "anon", body: { tenant_assignment_token: token } });
      await ctx.verify("the pending registration names the identity", [
        check("200 with the e-mail and name", pending.status === 200 && text(pending.body, "email") === ctx.email("orphan") && text(pending.body, "name") === "Orphan", pending.body),
      ]);
      const bad = await saas(ctx, "finalize with a bad token", "POST", "/register/finalize", { as: "anon", body: { tenant_assignment_token: "not-a-token" } });
      await ctx.verify("a bad token is refused", [check("4xx", bad.status >= 400 && bad.status < 500, bad.body)]);
      const done = await saas(ctx, "finalize", "POST", "/register/finalize", { as: "anon", body: { tenant_assignment_token: token, workspaceName: "Orphan HQ" } });
      const access = text(done.body, "access_token");
      await ctx.verify("finalize opens a workspace and answers a session", [
        check("200 with tokens", done.status === 200 && access !== "" && text(done.body, "refresh_token") !== "", done.body),
        check("the user is the account", text(done.body, "user", "email") === ctx.email("orphan"), done.body),
      ]);
      const plan = await ctx.api("the new workspace's plan", { method: "GET", path: "/api/saas/tenant/plan", token: access });
      const current = await ctx.api("the new workspace", { method: "GET", path: "/api/saas/workspaces/current", token: access });
      await ctx.verify("the session reads a workspace on the free plan", [
        check("free plan", text(plan.body, "current", "_id") === free.id, plan.body),
        check("named Orphan HQ", text(current.body, "name") === "Orphan HQ", current.body),
      ]);
      const twice = await saas(ctx, "finalize again", "POST", "/register/finalize", { as: "anon", body: { tenant_assignment_token: token } });
      await ctx.verify("an account with a workspace cannot finalize again", [check("400 saas.errors.user.already_has_workspace", twice.status === 400 && code(twice) === "saas.errors.user.already_has_workspace", twice.body)]);
    },
  },
  {
    id: "the-pricing-catalogue-lists-public-plans-in-order",
    title: "the public catalogue lists active public plans by order, hides the rest, and names the default plan only when it is on sale",
    entryPoint: "GET /api/saas/pricing, GET /api/saas/register/plan, /pricing",
    async run(/** @type {Ctx} */ ctx) {
      const empty = await saas(ctx, "pricing with no plan", "GET", "/pricing", { as: "anon" });
      await ctx.verify("an empty catalogue lists nothing and names no default", [check("no plans, no default", list(empty.body, "plans").length === 0 && pickNull(empty.body, "defaultPlanId"), empty.body)]);
      const pro = await createPlan(ctx, "pro", { price: 20, order: 2, name: { en: "Pro" } });
      const free = await createPlan(ctx, "free", { order: 1, name: { en: "Free" } });
      const secret = await createPlan(ctx, "secret", { order: 0, isPublic: false, name: { en: "Secret" } });
      await createPlan(ctx, "retired", { order: 0, isActive: false, name: { en: "Retired" } });
      const hidden = await saas(ctx, "pricing while the default plan is hidden", "GET", "/pricing", { as: "anon" });
      const hiddenPlan = await saas(ctx, "the registration plan while the default plan is hidden", "GET", "/register/plan", { as: "anon" });
      await ctx.verify("a default plan that is not on sale is not named by pricing, though sign-up opens on it", [
        check("defaultPlanId is null", pickNull(hidden.body, "defaultPlanId"), hidden.body),
        check("sign-up opens on the hidden lowest-order free plan", text(hiddenPlan.body, "plan", "_id") === secret.id, hiddenPlan.body),
      ]);
      const moved = await saas(ctx, "move the hidden plan after the free plan", "PUT", `/plans/${secret.id}`, { body: { order: 9 } });
      await ctx.verify("the hidden plan is moved down", [check("PUT answers 200", moved.status === 200, moved.body)], { critical: true });
      const pricing = await saas(ctx, "pricing", "GET", "/pricing", { as: "anon" });
      const slugs = list(pricing.body, "plans").map((plan) => text(plan, "slug"));
      await ctx.verify("only active public plans, by order", [
        check("free then pro", JSON.stringify(slugs) === JSON.stringify(["free", "pro"]), slugs),
        check("the default plan is the free plan", text(pricing.body, "defaultPlanId") === free.id, pricing.body),
        check("a price is shown as stored", list(pricing.body, "plans")[1]?.price === 20 && text(list(pricing.body, "plans")[1], "currency") === "EUR", pricing.body),
      ]);
      const plan = await saas(ctx, "the registration plan", "GET", "/register/plan", { as: "anon", body: undefined });
      const chosen = await ctx.api("the registration plan with a chosen plan", { method: "GET", path: `/api/saas/register/plan?plan=${pro.id}`, as: "anon" });
      await ctx.verify("the sign-up screen names the plan it opens on, and the chosen paid plan", [
        check("the workspace opens on the free plan", text(plan.body, "plan", "_id") === free.id && pick(plan.body, "requestedPlan") === null, plan.body),
        check("the chosen plan is named", text(chosen.body, "requestedPlan", "_id") === pro.id && text(chosen.body, "plan", "_id") === free.id, chosen.body),
      ]);
    },
  },
];
