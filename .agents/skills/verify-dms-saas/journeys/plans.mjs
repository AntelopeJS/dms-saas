import { guarded } from "../guard.mjs";
import { check, createPlan, isText, list, pick, planBody, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key the module answers
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * Waits for a plan to show as the visitor's current plan.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The visitor
 * @param {string} planId The plan awaited
 * @returns {Promise<string>} The id of the plan the workspace ends on
 */
async function settledPlan(ctx, account, planId) {
  let current = "";
  for (let attempt = 0; attempt < 40 && current !== planId; attempt += 1) {
    const answer = await saas(ctx, `${account}'s plan`, "GET", "/tenant/plan", { as: account });
    current = text(answer.body, "current", "_id");
    if (current !== planId) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return current;
}

/** Catalogue › Plans: the plan editor's writes, selling, deleting and retiring a plan. */
export const journeys = guarded([
  {
    id: "a-plan-write-is-validated-and-defaulted",
    title: "a plan gets its slug from its name, trimmed texts, the documented defaults and the next order, and bad intervals and member caps are refused",
    entryPoint: "POST /api/saas/plans, GET /api/saas/plans/:id",
    async run(/** @type {Ctx} */ ctx) {
      const first = await saas(ctx, "create a plan from a padded name", "POST", "/plans", { body: { name: { en: "  Pro Plan  " }, price: 0, currency: "EUR", interval: "month" } });
      const second = await saas(ctx, "create a second plan", "POST", "/plans", { body: { name: { en: "Second" }, price: 0, currency: "EUR", interval: "year" } });
      const one = await saas(ctx, "read the first plan", "GET", `/plans/${text(first.body, "_id")}`);
      const two = await saas(ctx, "read the second plan", "GET", `/plans/${text(second.body, "_id")}`);
      await ctx.verify("slug, trimmed text and defaults", [
        check("the slug comes from the trimmed name: pro-plan", text(one.body, "slug") === "pro-plan", one.body),
        check("the name is saved trimmed", text(one.body, "name", "en") === "Pro Plan" || text(one.body, "name") === "Pro Plan", one.body),
        check("on sale, public, unlimited members by default", pick(one.body, "isActive") === true && pick(one.body, "isPublic") === true && pick(one.body, "maxMembers") === -1, one.body),
        check("orders are 0 then 1", pick(one.body, "order") === 0 && pick(two.body, "order") === 1, [pick(one.body, "order"), pick(two.body, "order")]),
        check("the interval is stored as written", text(two.body, "interval") === "year", two.body),
      ]);
      const interval = await saas(ctx, "create a weekly plan", "POST", "/plans", { body: planBody({ slug: "weekly", interval: "week" }) });
      await ctx.verify("only a documented interval is accepted", [check("400 saas.errors.plan.invalid_interval", interval.status === 400 && code(interval) === "saas.errors.plan.invalid_interval", interval.body)]);
      const cap = async (/** @type {unknown} */ value, /** @type {boolean} */ accepted) => {
        const answer = await saas(ctx, `create a plan capped at ${JSON.stringify(value)}`, "POST", "/plans", { body: planBody({ slug: `cap-${String(value).replace(/\W/g, "_")}`, maxMembers: value }) });
        return check(`maxMembers ${JSON.stringify(value)} is ${accepted ? "accepted" : "refused with $saas.errors.plan.invalid_member_cap"}`, accepted ? answer.status === 200 : answer.status === 400 && JSON.stringify(answer.body).includes("$saas.errors.plan.invalid_member_cap"), answer.body);
      };
      await ctx.verify("the member cap is -1 (unlimited) or a whole number from 1", [await cap(-1, true), await cap(1, true), await cap(25, true), await cap(0, false), await cap(-2, false), await cap(1.5, false)]);
      const missing = await saas(ctx, "read a plan that does not exist", "GET", "/plans/no-such-plan");
      const put = await saas(ctx, "save a plan that does not exist", "PUT", "/plans/no-such-plan", { body: { order: 3 } });
      await ctx.verify("an unknown plan is 404", [
        check("GET: 404 saas.errors.plan.not_found", missing.status === 404 && code(missing) === "saas.errors.plan.not_found", missing.body),
        check("PUT: 404 saas.errors.plan.not_found", put.status === 404 && code(put) === "saas.errors.plan.not_found", put.body),
      ]);
      const partial = await saas(ctx, "change only the order", "PUT", `/plans/${text(first.body, "_id")}`, { body: { order: 7 } });
      const after = await saas(ctx, "read the plan after a partial save", "GET", `/plans/${text(first.body, "_id")}`);
      await ctx.verify("a save keeps the fields and texts it leaves out", [
        check("200", partial.status === 200, partial.body),
        check("order 7, name and slug unchanged", pick(after.body, "order") === 7 && text(after.body, "slug") === "pro-plan" && JSON.stringify(after.body).includes("Pro Plan"), after.body),
      ]);
    },
  },
  {
    id: "a-paid-plan-is-saved-but-not-payable-without-stripe",
    title: "a priced plan is saved with the not-synced notice and is not offered as payable to a workspace",
    entryPoint: "POST /api/saas/plans, GET /api/saas/tenant/plan",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const paid = await saas(ctx, "create a paid plan", "POST", "/plans", { body: planBody({ slug: "pro", price: 29, order: 1 }) });
      await ctx.verify("the plan is saved with the not-synced warning", [
        check("200 with an id", paid.status === 200 && text(paid.body, "_id") !== "", paid.body),
        check("the notice says Stripe is not configured", JSON.stringify(paid.body).includes("$saas.catalog.editor.notice.stripe_not_synced"), paid.body),
      ], { critical: true });
      const visitor = await register(ctx, "shopper");
      const plan = await saas(ctx, "the plans the workspace is offered", "GET", "/tenant/plan", { as: "shopper" });
      const offered = list(plan.body, "available").find((entry) => text(entry, "_id") === text(paid.body, "_id"));
      await ctx.verify("the paid plan is listed but not payable", [
        check("the workspace registered", visitor.answer.status === 200, visitor.answer.body),
        check("the paid plan is offered", offered !== undefined, plan.body),
        check("checkoutAvailable is false", offered !== undefined && offered.checkoutAvailable === false, offered),
      ]);
      const pricing = await saas(ctx, "public pricing", "GET", "/pricing", { as: "anon" });
      await ctx.verify("pricing still lists the paid plan at its price", [
        check("free then pro, pro at 29 EUR", JSON.stringify(list(pricing.body, "plans").map((entry) => [text(entry, "slug"), entry.price])) === JSON.stringify([["free", 0], ["pro", 29]]), pricing.body),
      ]);
    },
  },
  {
    id: "stop-selling-moves-nobody-and-delete-needs-an-empty-plan",
    title: "taking a plan off sale keeps its workspaces on it, and a plan with a workspace cannot be deleted until it is empty",
    entryPoint: "PUT /api/saas/plans/:id, DELETE /api/saas/plans/:id",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free");
      const spare = await createPlan(ctx, "spare", { order: 3 });
      const visitor = await register(ctx, "resident");
      await ctx.verify("a workspace sits on the free plan", [check("registered", visitor.answer.status === 200, visitor.answer.body)], { critical: true });
      const off = await saas(ctx, "stop selling the free plan", "PUT", `/plans/${free.id}`, { body: { isActive: false } });
      const plan = await saas(ctx, "the resident's plan", "GET", "/tenant/plan", { as: "resident" });
      const pricing = await saas(ctx, "pricing", "GET", "/pricing", { as: "anon" });
      await ctx.verify("the plan leaves pricing but its workspace stays on it", [
        check("200", off.status === 200, off.body),
        check("the resident is still on the free plan", text(plan.body, "current", "_id") === free.id, plan.body),
        check("pricing lists only the spare plan", JSON.stringify(list(pricing.body, "plans").map((entry) => text(entry, "slug"))) === JSON.stringify(["spare"]), pricing.body),
      ]);
      const refused = await saas(ctx, "delete the plan that holds a workspace", "DELETE", `/plans/${free.id}`);
      await ctx.verify("deleting a plan that holds a workspace is refused", [check("409 saas.errors.plan.has_workspaces", refused.status === 409 && code(refused) === "saas.errors.plan.has_workspaces", refused.body)]);
      const removed = await saas(ctx, "delete the unused plan", "DELETE", `/plans/${spare.id}`);
      const listed = await saas(ctx, "the catalogue after the delete", "GET", "/plans");
      await ctx.verify("an empty plan is deleted and leaves the catalogue", [
        check("200", removed.status === 200, removed.body),
        check("spare is not listed", !list(listed.body).some((entry) => text(entry, "slug") === "spare"), listed.body),
      ]);
    },
  },
  {
    id: "retiring-a-plan-moves-its-workspaces-then-the-plan-can-go",
    title: "retiring a plan needs its slug typed and an active target, closes it to sign-ups, moves its workspaces, and the plan is then deletable",
    entryPoint: "POST /api/saas/plans-deletion/:id/migrate-and-delete, /api/saas/plan-migrations/:id",
    async run(/** @type {Ctx} */ ctx) {
      const source = await createPlan(ctx, "source", { order: 0 });
      const target = await createPlan(ctx, "target", { order: 1 });
      const dormant = await createPlan(ctx, "dormant", { order: 2, isActive: false });
      const visitor = await register(ctx, "mover");
      await ctx.verify("a workspace sits on the source plan", [check("registered on source", visitor.answer.status === 200, visitor.answer.body)], { critical: true });
      const retire = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body) => saas(ctx, label, "POST", `/plans-deletion/${source.id}/migrate-and-delete`, { body });
      const wrongText = await retire("retire with the wrong confirmation", { targetPlanId: target.id, confirmText: "nope" });
      const inactive = await retire("retire towards an inactive plan", { targetPlanId: dormant.id, confirmText: "source" });
      const itself = await retire("retire towards itself", { targetPlanId: source.id, confirmText: "source" });
      await ctx.verify("the retirement is refused until it is confirmed and has an active other target", [
        check("a wrong typed key is 400", wrongText.status === 400, wrongText.body),
        check("an inactive target is 400 saas.errors.plan.target_must_be_active", inactive.status === 400 && code(inactive) === "saas.errors.plan.target_must_be_active", inactive.body),
        check("the plan itself is 400 saas.errors.plan.target_must_be_active", itself.status === 400 && code(itself) === "saas.errors.plan.target_must_be_active", itself.body),
      ]);
    },
  },
  {
    id: "a-retired-plans-workspaces-move-and-the-plan-can-then-go",
    title: "a started retirement closes the plan to sign-ups, moves its workspaces to the target, and the plan is then deletable",
    entryPoint: "POST /api/saas/plans-deletion/:id/migrate-and-delete, /api/saas/plan-migrations/:id",
    async run(/** @type {Ctx} */ ctx) {
      const source = await createPlan(ctx, "source", { order: 0 });
      const target = await createPlan(ctx, "target", { order: 1 });
      const visitor = await register(ctx, "mover");
      await ctx.verify("a workspace sits on the source plan", [check("registered on source", visitor.answer.status === 200, visitor.answer.body)], { critical: true });
      const retire = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body) => saas(ctx, label, "POST", `/plans-deletion/${source.id}/migrate-and-delete`, { body });
      const impact = await saas(ctx, "the impact before retiring", "GET", `/plans-deletion/${source.id}/impact`);
      await ctx.verify("the impact counts the workspace", [check("two workspaces on the source plan (the default workspace and the resident)", pick(impact.body, "workspaces") === 2, impact.body)]);
      const started = await retire("retire the source plan", { targetPlanId: target.id, confirmText: " source " });
      const migrationId = text(started.body, "migrationId");
      await ctx.verify("the migration starts", [check("200 with a migration id", started.status === 200 && migrationId !== "", started.body)], { critical: true });
      const sourceAfter = await saas(ctx, "the source plan after retiring", "GET", `/plans/${source.id}`);
      const second = await retire("retire again while the plan is closed", { targetPlanId: target.id, confirmText: "source" });
      await ctx.verify("the plan is closed to sign-ups and kept in the catalogue", [
        check("isActive false, not deleted", pick(sourceAfter.body, "isActive") === false && pick(sourceAfter.body, "isDeleted") !== true, sourceAfter.body),
        check("a plan with a finished or running migration is retired once: 409 or a second started migration is not silent", second.status === 409 || second.status === 200, second.body),
      ]);
      const moved = await settledPlan(ctx, "mover", target.id);
      await ctx.verify("the workspace is moved to the target plan", [check("the resident is on target", moved === target.id, moved)]);
      const totals = await saas(ctx, "the migration totals", "GET", `/plan-migrations/${migrationId}/totals`);
      const workspaces = await saas(ctx, "the migration's workspaces", "GET", `/plan-migrations/${migrationId}/workspaces`);
      await ctx.verify("the migration records its workspaces", [
        check("totals answer 200", totals.status === 200, totals.body),
        check("the workspace list answers 200 and names the resident's workspace", workspaces.status === 200 && JSON.stringify(workspaces.body).includes(visitor.tenantId), workspaces.body),
      ]);
      const removed = await saas(ctx, "delete the retired plan", "DELETE", `/plans/${source.id}`);
      await ctx.verify("once nobody is left the retired plan is deletable", [check("200", removed.status === 200, removed.body)]);
    },
  },
  {
    id: "only-the-platform-owner-edits-the-catalogue",
    title: "a workspace owner and an anonymous caller cannot write, delete or retire plans",
    entryPoint: "/api/saas/plans",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free");
      await register(ctx, "customer");
      const checks = [];
      for (const [who, label] of [["customer", "a workspace owner"], ["anon", "an anonymous caller"]]) {
        const create = await saas(ctx, `${label} creates a plan`, "POST", "/plans", { as: who, body: planBody({ slug: "sneaky" }) });
        const update = await saas(ctx, `${label} edits a plan`, "PUT", `/plans/${free.id}`, { as: who, body: { price: 99 } });
        const remove = await saas(ctx, `${label} deletes a plan`, "DELETE", `/plans/${free.id}`, { as: who });
        checks.push(check(`${label} cannot create`, create.status === 401 || create.status === 403, create.status), check(`${label} cannot edit`, update.status === 401 || update.status === 403, update.status), check(`${label} cannot delete`, remove.status === 401 || remove.status === 403, remove.status));
      }
      const stored = await saas(ctx, "the plan after the refused writes", "GET", `/plans/${free.id}`);
      checks.push(check("the plan is unchanged: price 0", pick(stored.body, "price") === 0, stored.body));
      await ctx.verify("the catalogue is the platform owner's", checks);
    },
  },
]);
