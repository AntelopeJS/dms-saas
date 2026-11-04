import { allPermissionIds, check, createPlan, fixture, isText, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const DAY_MS = 86_400_000;

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {number} days Days from now
 * @returns {string} That instant
 */
function inDays(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} planId The plan
 * @param {string} status The status
 * @param {boolean} [stripe] Whether the subscription carries Stripe ids
 */
async function put(ctx, tenantId, planId, status, stripe = true) {
  await fixture(ctx, `put ${tenantId} as ${status}`, "POST", "/subscription", {
    tenantId,
    planId,
    status,
    stripeCustomerId: stripe ? `cus_${tenantId.slice(0, 8)}` : undefined,
    stripeSubscriptionId: stripe ? `sub_${tenantId.slice(0, 8)}` : undefined,
  });
}

/** Grant free access, complimentary windows, churn through a suspension, and credit-note bodies. */
export const operatorRuleJourneys = [
  {
    id: "grant-free-access-follows-the-plan-and-date-rules",
    title: "the grant answers each documented case: a free date in the future, a past date, an unknown plan, an unsold plan, another audience, the workspace's own plan once unsold, and a Stripe subscription that needs acknowledging",
    entryPoint: "POST /api/saas/workspaces/:tenantId/grant-free-access",
    async run(/** @type {Ctx} */ ctx) {
      const permissions = await allPermissionIds(ctx);
      const own = await createPlan(ctx, "own", { order: 0, permissions });
      const other = await createPlan(ctx, "other", { order: 1 });
      const retired = await createPlan(ctx, "retired", { order: 2, isActive: false });
      const business = await createPlan(ctx, "business", { order: 3, audience: "business" });
      const doomed = await createPlan(ctx, "doomed", { order: 4 });
      await saas(ctx, "delete the unused plan", "DELETE", `/plans/${doomed.id}`);
      const customer = await register(ctx, "grantee", { workspaceName: "Grantee Co" });
      const grant = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body, tenantId = customer.tenantId) => saas(ctx, label, "POST", `/workspaces/${tenantId}/grant-free-access`, { body });
      /** @type {{ label: string, answer: import("../../saas.mjs").Answer, error: string }[]} */
      const refusals = [
        { label: "an unknown plan", answer: await grant("grant an unknown plan", { planId: "no-such-plan" }), error: "saas.errors.plan.invalid" },
        { label: "a deleted plan", answer: await grant("grant a deleted plan", { planId: doomed.id }), error: "saas.errors.plan.invalid" },
        { label: "an unsold plan the workspace is not on", answer: await grant("grant an unsold plan", { planId: retired.id }), error: "saas.errors.plan.invalid" },
        { label: "a plan for the other customer type", answer: await grant("grant a business plan to an individual", { planId: business.id }), error: "saas.errors.plan.not_available_for_customer_type" },
        { label: "a date in the past", answer: await grant("grant until a past date", { planId: other.id, freeUntil: "2020-01-01T00:00:00Z" }), error: "saas.errors.workspace_create.free_until_past" },
      ];
      await ctx.verify("each refusal names its reason", refusals.map(({ label, answer, error }) => check(`${label}: 400 ${error}`, answer.status === 400 && code(answer) === error, answer.body)));
      const until = inDays(30);
      const granted = await grant("grant a plan until a date", { planId: other.id, freeUntil: until });
      const plan = await saas(ctx, "the workspace after the grant", "GET", `/workspaces/${customer.tenantId}/overview`);
      await ctx.verify("a granted plan is complimentary until the date", [
        check("200 with the plan and the date", granted.status === 200 && text(granted.body, "planId") === other.id && Math.abs(new Date(text(granted.body, "freeUntil")).getTime() - new Date(until).getTime()) < 1000, granted.body),
        check("the operator view reads it back: complimentary, on that plan, with that end", pick(plan.body, "isComplimentary") === true && text(plan.body, "planName") === "other" && Math.abs(new Date(text(plan.body, "freeUntil")).getTime() - new Date(until).getTime()) < 1000, plan.body),
      ]);
      const open = await grant("grant a plan with no end date", { planId: other.id, freeUntil: null });
      const openPlan = await saas(ctx, "the workspace after an open-ended grant", "GET", `/workspaces/${customer.tenantId}/overview`);
      await ctx.verify("a grant without a date has no end", [check("200 and no freeUntil", open.status === 200 && pick(openPlan.body, "freeUntil") === null && pick(openPlan.body, "isComplimentary") === true, openPlan.body)]);
      await saas(ctx, "stop selling the workspace's own plan", "PUT", `/plans/${other.id}`, { body: { isActive: false } });
      const ownPlan = await grant("grant the workspace's own plan once unsold", { planId: other.id });
      await ctx.verify("the plan the workspace is on is always offered, even once it is no longer sold", [check("200", ownPlan.status === 200, ownPlan.body)]);
      const stripeBacked = await register(ctx, "stripe-backed", { workspaceName: "Billed Co" });
      await put(ctx, stripeBacked.tenantId, own.id, "active", true);
      const unacknowledged = await grant("grant over a paid Stripe subscription", { planId: own.id }, stripeBacked.tenantId);
      await ctx.verify("a paid Stripe subscription must be acknowledged before it is cancelled", [check("400 saas.errors.workspace.cancellation_not_acknowledged", unacknowledged.status === 400 && code(unacknowledged) === "saas.errors.workspace.cancellation_not_acknowledged", unacknowledged.body)]);
      const unknownTenant = await grant("grant on a workspace that does not exist", { planId: own.id }, "no-such-workspace");
      await ctx.verify("an unknown workspace is refused", [check("404 or 400", unknownTenant.status === 404 || unknownTenant.status === 400, unknownTenant.body)]);
      const noType = await grant("grant a business plan to the default workspace, which has no customer type", { planId: business.id }, "default");
      await ctx.verify("a workspace with no customer type is offered every plan", [check("200", noType.status === 200, noType.body)]);
    },
  },
  {
    id: "complimentary-access-ending-within-7-days-is-flagged",
    title: "access granted until 5 days from now is flagged on Needs attention and under the Complimentary access ending view, one ending in 10 days is not",
    entryPoint: "GET /api/saas/dashboard/attention, Customers › Workspaces",
    async run(/** @type {Ctx} */ ctx) {
      const plan = await createPlan(ctx, "gift", { order: 0 });
      const soon = await register(ctx, "soon", { workspaceName: "Soon Co" });
      const later = await register(ctx, "later", { workspaceName: "Later Co" });
      const grant = (/** @type {string} */ tenantId, /** @type {number} */ days) => saas(ctx, `grant for ${days} days`, "POST", `/workspaces/${tenantId}/grant-free-access`, { body: { planId: plan.id, freeUntil: inDays(days) } });
      const grants = [await grant(soon.tenantId, 5), await grant(later.tenantId, 10)];
      const attention = await saas(ctx, "attention with two grants", "GET", "/dashboard/attention");
      const card = list(attention.body, "items").find((entry) => text(entry, "id") === "complimentary_ending");
      await ctx.verify("only the grant ending within 7 days is flagged", [
        check("both grants are accepted", grants.every((answer) => answer.status === 200), grants.map((answer) => answer.body)),
        check("the card counts 1", pick(card, "title", "params", "count", "value") === 1, card),
        check("and names the workspace", pick(card, "description", "params", "name") === "Soon Co", card),
        check("the card opens the view", text(card, "to") === "/modules/saas/customers/workspaces?view=complimentary-ending", card),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/customers/workspaces");
      await ctx.verify("the view counts and lists it", [tab.visible({ role: "button", name: "Complimentary access ending this week 1" }, { timeoutMs: 60_000 })]);
      await tab.click({ role: "button", name: "Complimentary access ending this week 1" });
      await ctx.verify("and lists only that workspace", [tab.shows(/Soon Co/, { timeoutMs: 30_000 }), tab.shows(/Later Co/, { timeoutMs: 5_000, not: true })]);
    },
  },
  {
    id: "churn-counts-a-cancellation-that-followed-a-suspension",
    title: "a paying workspace that went past due, then suspended, then cancelled still counts the MRR it paid before it fell past due",
    entryPoint: "GET /api/saas/dashboard/churn",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const keeper = await register(ctx, "stays");
      const leaver = await register(ctx, "goes");
      await put(ctx, keeper.tenantId, pro.id, "active");
      await put(ctx, leaver.tenantId, pro.id, "active");
      for (const status of ["past_due", "suspended", "cancelled"]) {
        await put(ctx, leaver.tenantId, pro.id, status);
        if (status !== "cancelled") {
          const mid = await saas(ctx, `churn while ${status}`, "GET", "/dashboard/churn");
          await ctx.verify(`while ${status} nothing is lost yet`, [check("0 %", pick(mid.body, "value") === 0, mid.body)]);
        }
      }
      const churn = await saas(ctx, "churn after the cancellation", "GET", "/dashboard/churn");
      await ctx.verify("the cancellation counts what was paid before the workspace fell past due", [check("50 / (50 + 50) = 50 %", pick(churn.body, "value") === 50, churn.body)]);
    },
  },
  {
    id: "a-credit-note-request-is-validated-before-stripe-is-asked",
    title: "a credit note without a reason, with an unknown reason, a fractional amount, no request id or an unknown mode is refused 400 before the 503",
    entryPoint: "POST /api/saas/credit-notes/issue",
    async run(/** @type {Ctx} */ ctx) {
      const valid = { invoiceId: "in_none", amount: 100, mode: "credit_to_balance", reason: "goodwill", requestId: "req-valid-1" };
      const attempt = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body) => saas(ctx, label, "POST", "/credit-notes/issue", { body });
      /** @type {{ label: string, body: Record<string, unknown> }[]} */
      const cases = [
        { label: "no reason", body: { ...valid, reason: undefined } },
        { label: "an unknown reason", body: { ...valid, reason: "because" } },
        { label: "a fractional amount", body: { ...valid, amount: 10.5 } },
        { label: "a negative amount", body: { ...valid, amount: -5 } },
        { label: "no request id", body: { ...valid, requestId: undefined } },
        { label: "an empty invoice id", body: { ...valid, invoiceId: "" } },
        { label: "a request id of 101 characters", body: { ...valid, requestId: "r".repeat(101) } },
        { label: "an unknown mode", body: { ...valid, mode: "cash" } },
      ];
      const results = [];
      for (const { label, body } of cases) {
        const answer = await attempt(`credit note with ${label}`, body);
        results.push(check(`${label}: 400`, answer.status === 400, answer.body));
      }
      await ctx.verify("every malformed request is refused 400", results);
      const reasons = [];
      for (const reason of ["service_issue", "billing_error", "duplicate", "goodwill", "fraudulent", "other"]) {
        const answer = await attempt(`credit note for ${reason}`, { ...valid, reason, requestId: `req-${reason}` });
        reasons.push(check(`${reason}: passes validation, then 503 saas.errors.stripe.not_configured`, answer.status === 503 && code(answer) === "saas.errors.stripe.not_configured", answer.body));
      }
      const modes = [];
      for (const mode of ["credit_to_balance", "refund", "reduce_amount_due"]) {
        const answer = await attempt(`credit note in mode ${mode}`, { ...valid, mode, requestId: `req-${mode}` });
        modes.push(check(`${mode}: 503 saas.errors.stripe.not_configured`, answer.status === 503, answer.body));
      }
      await ctx.verify("the six reasons and the three modes are valid", [...reasons, ...modes]);
    },
  },
  {
    id: "the-workspace-plan-page-shows-the-plan-the-workspace-is-on",
    title: "after an operator moves a workspace to a plan, the workspace's own plan page names that plan and its complimentary state, not another workspace's",
    entryPoint: "POST /api/saas/workspaces/:tenantId/grant-free-access, GET /api/saas/tenant/plan",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "starter", { order: 0 });
      const gift = await createPlan(ctx, "gifted", { order: 1 });
      const customer = await register(ctx, "pagegrantee", { workspaceName: "Page Co" });
      const granted = await saas(ctx, "grant the gifted plan", "POST", `/workspaces/${customer.tenantId}/grant-free-access`, { body: { planId: gift.id } });
      const plan = await saas(ctx, "the workspace's plan page", "GET", "/tenant/plan", { as: "pagegrantee" });
      await ctx.verify("the plan page reads the workspace's own subscription", [
        check("the grant is accepted", granted.status === 200, granted.body),
        check("current plan: gifted", text(plan.body, "current", "slug") === "gifted", plan.body),
        check("complimentary", pick(plan.body, "isComplimentary") === true, plan.body),
      ]);
    },
  },
];
