import { guarded } from "../guard.mjs";
import { peopleMoreJourneys } from "./parts/people-more.mjs";
import { check, createPlan, fixture, isText, pick, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * A segment save, for the validation table.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What is wrong with the save
 * @param {Record<string, unknown>} body The segment
 * @param {string} error The code a refusal carries
 * @returns {Promise<import("../saas.mjs").Check>} The check
 */
async function refused(ctx, label, body, error) {
  const answer = await saas(ctx, `save a segment with ${label}`, "POST", "/segments", { body });
  return check(`${label}: 400 ${error}`, answer.status === 400 && code(answer) === error, answer.body);
}

const EMAIL = { field: "email", operator: "contains", value: "alpha" };

/** Customers › Users and Segments: platform roles and the rule-based segments. */
export const journeys = guarded([
  {
    id: "platform-admin-roles-follow-their-rules",
    title: "promoting and demoting follow the documented rules: no double promotion, no self-demotion, no demoting a non-admin, and only a platform admin acts",
    entryPoint: "POST /api/saas/platform-owners/:userId/promote and /demote",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const colleague = await register(ctx, "colleague");
      const adminId = text((await ctx.api("who am I", { method: "GET", path: "/api/auth/me" })).body, "_id");
      const owners = (/** @type {string} */ path, /** @type {string} */ as) => saas(ctx, `${path} as ${as}`, "POST", `/platform-owners/${path}`, { as });
      const sneaky = await owners(`${colleague.userId}/promote`, "colleague");
      const promoted = await owners(`${colleague.userId}/promote`, "admin");
      const twice = await owners(`${colleague.userId}/promote`, "admin");
      await ctx.verify("only a platform admin promotes, and only a non-admin", [
        check("a workspace owner cannot promote", sneaky.status === 401 || sneaky.status === 403, sneaky.status),
        check("promoting answers 200 with the user id", promoted.status === 200 && text(promoted.body, "userId") === colleague.userId, promoted.body),
        check("promoting an admin again: 409 saas.errors.platform_owner.already_owner", twice.status === 409 && code(twice) === "saas.errors.platform_owner.already_owner", twice.body),
      ]);
      const self = await owners(`${adminId}/demote`, "admin");
      const demoted = await owners(`${colleague.userId}/demote`, "admin");
      const notAdmin = await owners(`${colleague.userId}/demote`, "admin");
      await ctx.verify("demotion rules", [
        check("nobody demotes themselves: 400 saas.errors.platform_owner.cannot_demote_self", self.status === 400 && code(self) === "saas.errors.platform_owner.cannot_demote_self", self.body),
        check("another admin is demoted: 200", demoted.status === 200, demoted.body),
        check("demoting a user who is not an admin: 409 saas.errors.platform_owner.not_owner", notAdmin.status === 409 && code(notAdmin) === "saas.errors.platform_owner.not_owner", notAdmin.body),
      ]);
      const back = await owners(`${colleague.userId}/promote-confirm`, "admin");
      await ctx.verify("the confirmation read answers for the target", [check("the promote confirmation is a GET, so POST is refused", back.status >= 400, back.status)]);
    },
  },
  {
    id: "a-segment-rejects-malformed-rules",
    title: "a segment needs a name of at most 120 characters, a description of at most 500, known fields, their operators, a list for in and nin, and a depth of at most 8",
    entryPoint: "POST /api/saas/segments",
    async run(/** @type {Ctx} */ ctx) {
      const good = { logical: "and", conditions: [EMAIL] };
      /** @type {(levels: number) => unknown} */
      const nested = (levels) => (levels === 0 ? EMAIL : { logical: "and", conditions: [nested(levels - 1)] });
      await ctx.verify("name and description bounds", [
        await refused(ctx, "no name", { conditions: good }, "saas.errors.segments.name_required"),
        await refused(ctx, "a blank name", { name: "   ", conditions: good }, "saas.errors.segments.name_required"),
        await refused(ctx, "a 121-character name", { name: "n".repeat(121), conditions: good }, "saas.errors.segments.too_long"),
        await refused(ctx, "a 501-character description", { name: "ok", description: "d".repeat(501), conditions: good }, "saas.errors.segments.too_long"),
      ]);
      await ctx.verify("rule bounds", [
        await refused(ctx, "an unknown field", { name: "x", conditions: { logical: "and", conditions: [{ field: "shoeSize", operator: "eq", value: 1 }] } }, "saas.errors.segments.unknown_field"),
        await refused(ctx, "an operator the field lacks", { name: "x", conditions: { logical: "and", conditions: [{ field: "email", operator: "gt", value: "a" }] } }, "saas.errors.segments.invalid_operator"),
        await refused(ctx, "a list operator without a list", { name: "x", conditions: { logical: "and", conditions: [{ kind: "workspaceRef", quantifier: "any", conditions: { logical: "and", conditions: [{ field: "status", operator: "in", value: "active" }] } }] } }, "saas.errors.segments.invalid_value"),
        await refused(ctx, "a scalar operator with a list", { name: "x", conditions: { logical: "and", conditions: [{ field: "email", operator: "eq", value: ["a"] }] } }, "saas.errors.segments.invalid_value"),
        await refused(ctx, "a group that is neither and nor or", { name: "x", conditions: { logical: "xor", conditions: [] } }, "saas.errors.segments.invalid_logical"),
        await refused(ctx, "a workspace rule with no quantifier", { name: "x", conditions: { logical: "and", conditions: [{ kind: "workspaceRef", conditions: { logical: "and", conditions: [] } }] } }, "saas.errors.segments.invalid_quantifier"),
        await refused(ctx, "a workspace rule with a role that is not member or owner", { name: "x", conditions: { logical: "and", conditions: [{ kind: "workspaceRef", quantifier: "any", role: "guest", conditions: { logical: "and", conditions: [] } }] } }, "saas.errors.segments.invalid_role"),
      ]);
      const depth7 = await saas(ctx, "save a segment 7 groups deep", "POST", "/segments", { body: { name: "deep ok", conditions: nested(6) } });
      await ctx.verify("a tree of at most 8 levels is accepted and a deeper one is not", [
        check("8 levels (7 groups and a condition): 200", depth7.status === 200, depth7.body),
        await refused(ctx, "9 levels", { name: "too deep", conditions: nested(8) }, "saas.errors.segments.conditions_too_deep"),
      ]);
    },
  },
  {
    id: "a-segment-counts-the-users-its-rules-match",
    title: "rules on e-mail and on workspaces match the right users with And and Or, evaluate now refreshes the count, and a duplicate is its own segment",
    entryPoint: "POST /api/saas/segments, /segments/:id/evaluate, /segments/:id/duplicate",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const names = ["alpha", "beta", "gamma"];
      for (const name of names) {
        const visitor = await register(ctx, name);
        await fixture(ctx, `publish the state of the workspace of ${name}`, "POST", "/recompute", { tenantId: visitor.tenantId });
      }
      const count = async (/** @type {string} */ label, /** @type {unknown} */ conditions) => {
        const created = await saas(ctx, `create the segment ${label}`, "POST", "/segments", { body: { name: label, conditions } });
        return { id: text(created.body, "_id") || text(created.body, "id"), count: pick(created.body, "estimatedCount"), answer: created };
      };
      const only = await count("only alpha", { logical: "and", conditions: [{ field: "email", operator: "contains", value: "alpha" }] });
      const either = await count("alpha or beta", { logical: "or", conditions: [{ field: "email", operator: "contains", value: "alpha" }, { field: "email", operator: "contains", value: "beta" }] });
      const both = await count("alpha and beta", { logical: "and", conditions: [{ field: "email", operator: "contains", value: "alpha" }, { field: "email", operator: "contains", value: "beta" }] });
      const owners = await count("owners of a free workspace", { logical: "and", conditions: [{ kind: "workspaceRef", quantifier: "any", role: "owner", conditions: { logical: "and", conditions: [{ field: "status", operator: "eq", value: "free" }] } }] });
      const everyone = await count("a verified e-mail", { logical: "and", conditions: [{ field: "isValidated", operator: "eq", value: true }] });
      await ctx.verify("each segment counts exactly the users it matches", [
        check("the segments are saved", [only, either, both, owners, everyone].every((entry) => entry.answer.status === 200 && entry.id !== ""), [only.answer.body, either.answer.body]),
        check("only alpha: 1 user", only.count === 1, only.answer.body),
        check("alpha or beta: 2 users", either.count === 2, either.answer.body),
        check("alpha and beta: 0 users", both.count === 0, both.answer.body),
        check("owners of a free workspace: the 3 registered visitors and the platform admin", owners.count === 4, owners.answer.body),
        check("a verified e-mail: only the platform admin (visitors are not verified)", everyone.count === 1, everyone.answer.body),
      ]);
      const preview = await saas(ctx, "preview the or rule before saving", "POST", "/segments/preview", { body: { conditions: { logical: "or", conditions: [{ field: "email", operator: "contains", value: "gamma" }] } } });
      const joined = await register(ctx, "alpha2");
      await fixture(ctx, "publish the state of the new workspace", "POST", "/recompute", { tenantId: joined.tenantId });
      const refreshed = await saas(ctx, "evaluate now", "POST", `/segments/${only.id}/evaluate`);
      await ctx.verify("the preview counts without saving, and evaluating now counts the user who joined since", [
        check("the preview matches gamma only", JSON.stringify(preview.body).includes("gamma") && !JSON.stringify(preview.body).includes("beta"), preview.body),
        check("alpha2 registered", joined.answer.status === 200, joined.answer.body),
        check("evaluate now: 2 users contain alpha", pick(refreshed.body, "estimatedCount") === 2, refreshed.body),
      ]);
      const copy = await saas(ctx, "duplicate the segment", "POST", `/segments/${only.id}/duplicate`);
      const copyId = text(copy.body, "_id") || text(copy.body, "id");
      await ctx.verify("a duplicate is a segment of its own with the same rules", [
        check("200 with another id", copy.status === 200 && copyId !== "" && copyId !== only.id, copy.body),
        check("it counts the same users", pick(copy.body, "estimatedCount") === 2, copy.body),
      ]);
      const probe = await fixture(ctx, "ping", "GET", "/ping");
      await ctx.verify("the fixture still answers", [check("ok", probe.status === 200, probe.body)]);
    },
  },
  ...peopleMoreJourneys,
]);
