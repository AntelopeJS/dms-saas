import { guarded } from "../guard.mjs";
import { seatJourneys } from "./parts/gating-more.mjs";
import { passwordWith, allPermissionIds, check, createPlan, fixture, isText, pick, planBody, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const PAGES_API = "/dms/pages/settings/workspace";

/**
 * @param {Ctx} ctx The journey
 * @param {string} tenantId The workspace
 * @param {string} userId The user
 * @param {string[]} rolePermissions What the user's role grants
 * @returns {Promise<string[]>} The effective permissions, sorted
 */
async function effective(ctx, tenantId, userId, rolePermissions) {
  const answer = await fixture(ctx, `the effective permissions of ${userId}`, "POST", "/effective-permissions", { tenantId, userId, rolePermissions });
  const permissions = pick(answer.body, "permissions");
  return Array.isArray(permissions) ? permissions.filter(isText) : [];
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} planId The plan
 * @returns {Promise<string[]>} The permissions stored on the plan itself
 */
async function storedPermissions(ctx, planId) {
  const answer = await saas(ctx, "the plan's stored permissions", "GET", `/plans/${planId}`);
  const permissions = pick(answer.body, "permissions");
  return Array.isArray(permissions) ? permissions.filter(isText) : [];
}

/** The plan caps what members of a workspace can do, and its member cap bounds invitations. */
export const journeys = guarded([
  {
    id: "the-plan-caps-members-and-gives-the-owner-all-of-it",
    title: "a member keeps only what both the role and the plan grant, the owner gets every permission of the plan, a parent plan's permissions are inherited, and * never reaches the owner",
    entryPoint: "dms-saas.plan-intersection permissions resolver",
    async run(/** @type {Ctx} */ ctx) {
      const ids = await allPermissionIds(ctx);
      const leaves = ids.filter((id) => !ids.some((other) => other.startsWith(`${id}.`)));
      const [a, b, c] = leaves;
      await ctx.verify("the tree offers permissions to grant", [check("at least three leaf permissions", a !== undefined && b !== undefined && c !== undefined, leaves.slice(0, 5))], { critical: true });
      if (a === undefined || b === undefined || c === undefined) return;
      const parent = await createPlan(ctx, "parent", { permissions: [a], order: 1 });
      const child = await createPlan(ctx, "child", { permissions: [b], inheritsFromPlanId: parent.id, order: 0 });
      await ctx.verify("the plans are saved", [check("parent and child answer 200", parent.answer.status === 200 && child.answer.status === 200, [parent.answer.body, child.answer.body])], { critical: true });
      const planPermissions = async () => [...new Set([...(await storedPermissions(ctx, parent.id)), ...(await storedPermissions(ctx, child.id))])].sort();
      const before = await planPermissions();
      const owner = await register(ctx, "boss");
      const stranger = await fixture(ctx, "an account that is not the owner", "POST", "/account-without-workspace", { email: ctx.email("member"), name: "Member", password: passwordWith() });
      const memberId = text(stranger.body, "userId");
      const ownerSet = await effective(ctx, owner.tenantId, owner.userId, [a, b, c]);
      const memberSet = await effective(ctx, owner.tenantId, memberId, [a, b, c]);
      const outsideSet = await effective(ctx, owner.tenantId, memberId, [c]);
      const within = (/** @type {string[]} */ granted, /** @type {string[]} */ plan) => granted.filter((id) => plan.includes(id)).sort();
      await ctx.verify("the owner gets the plan, inherited permissions included, whatever the roles hold", [
        check("the plan holds the parent's and the child's permissions", before.includes(a) && before.includes(b) && !before.includes(c), before),
        check("owner: exactly the plan's permissions", JSON.stringify(ownerSet) === JSON.stringify(before), ownerSet),
        check("owner with a role holding nothing still gets the plan", JSON.stringify(await effective(ctx, owner.tenantId, owner.userId, [])) === JSON.stringify(before), "owner, empty role"),
      ]);
      await ctx.verify("a member keeps the intersection of the role and the plan", [
        check("member with a, b and c: a and b", JSON.stringify(memberSet) === JSON.stringify(within([a, b, c], before)) && memberSet.length > 0, memberSet),
        check("member whose role grants only what the plan lacks: nothing", outsideSet.length === 0, outsideSet),
        check("member with a single granted permission: that one", JSON.stringify(await effective(ctx, owner.tenantId, memberId, [b])) === JSON.stringify([b]), "member, [b]"),
      ]);
      const edit = await saas(ctx, "the child plan stops granting b and grants c", "PUT", `/plans/${child.id}`, { body: { permissions: [c] } });
      const after = await planPermissions();
      const afterEdit = await effective(ctx, owner.tenantId, owner.userId, [a, b, c]);
      await ctx.verify("a plan edit applies to the workspace at once", [
        check("200", edit.status === 200, edit.body),
        check("the plan now holds a and c, not b", after.includes(a) && after.includes(c) && !after.includes(b), after),
        check("owner has exactly the new plan permissions", JSON.stringify(afterEdit) === JSON.stringify(after), afterEdit),
      ]);
      const star = await saas(ctx, "a plan that lists *", "PUT", `/plans/${child.id}`, { body: { permissions: ["*", c] } });
      const ownerStar = await effective(ctx, owner.tenantId, owner.userId, []);
      const memberStar = await effective(ctx, owner.tenantId, memberId, ["*"]);
      await ctx.verify("tenant ownership never grants *, even if the plan contains it", [
        check("the plan write is accepted", star.status === 200, star.body),
        check("the owner's set has no *", !ownerStar.includes("*"), ownerStar),
        check("an incoming * (the platform owner's wildcard) survives for another member", memberStar.includes("*"), memberStar),
      ]);
    },
  },
  {
    id: "the-plan-member-cap-bounds-invitations",
    title: "an invitation that would pass the plan's member cap is refused with 409, and a pending invitation takes a seat",
    entryPoint: "POST /dms/pages/settings/workspace/members/invite, GET /api/saas/tenant/plan",
    async run(/** @type {Ctx} */ ctx) {
      const ids = await allPermissionIds(ctx);
      await createPlan(ctx, "duo", planBody({ maxMembers: 2, permissions: ids }));
      const owner = await register(ctx, "seat-owner");
      const role = await ctx.api("create a role", { method: "POST", path: `${PAGES_API}/roles/create`, as: "seat-owner", body: { name: ctx.unique("Reader"), description: "", permissions: [] } });
      const roleId = text(role.body, "id");
      await ctx.verify("the owner can create a role", [check("200 with an id", role.status === 200 && roleId !== "", role.body)], { critical: true });
      const invite = (/** @type {string} */ name) => ctx.api(`invite ${name}`, { method: "POST", path: `${PAGES_API}/members/invite`, as: "seat-owner", body: { emails: [ctx.email(name)], roles: [roleId], asTenantOwner: false, language: "en" } });
      const first = await invite("first");
      const plan = await saas(ctx, "the seats after one invitation", "GET", "/tenant/plan", { as: "seat-owner" });
      const second = await invite("second");
      await ctx.verify("one member plus one pending invitation fill a two-seat plan", [
        check("the first invitation is accepted", first.status === 200, first.body),
        check("seats: 1 member, 1 pending invitation, 2 occupied", JSON.stringify(pick(plan.body, "seats")) === JSON.stringify({ members: 1, pendingInvites: 1, occupied: 2 }), plan.body),
        check("the second invitation is refused 409 saas.errors.plan.seat_limit_reached", second.status === 409 && (isText(second.body) ? second.body : text(second.body, "message")) === "saas.errors.plan.seat_limit_reached", second.body),
      ]);
      await ctx.verify("the workspace still has its owner", [check("the owner registered", owner.tenantId !== "", owner.answer.body)]);
    },
  },
  ...seatJourneys,
]);
