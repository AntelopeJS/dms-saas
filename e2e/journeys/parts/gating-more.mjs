import { allPermissionIds, check, createPlan, createRole, fixture, inviteMember, isText, joinMember, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {{ answer: import("../../saas.mjs").Answer }} invited The result of an invitation
 * @returns {boolean} Whether it was refused for lack of a seat
 */
function refusal(invited) {
  return invited.answer.status === 409 && code(invited.answer) === "saas.errors.plan.seat_limit_reached";
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} account The account that reads
 * @returns {Promise<unknown>} The seats block of the plan page
 */
async function seatsOf(ctx, account) {
  return pick((await saas(ctx, `${account} reads the seats`, "GET", "/tenant/plan", { as: account })).body, "seats");
}

/** Seats: platform support, expired invitations and a cap lowered under the member count. */
export const seatJourneys = [
  {
    id: "platform-support-and-expired-invitations-take-no-seat",
    title: "a platform admin who joins as support uses no seat, an expired invitation uses none, and the last seat of a two-seat plan is still invitable",
    entryPoint: "POST /api/saas/workspaces/:tenantId/join, GET /api/saas/tenant/plan",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "duo", { maxMembers: 2, permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "host");
      const role = await createRole(ctx, "host");
      await ctx.verify("the workspace holds its owner alone", [check("1 member, 0 invitations", JSON.stringify(await seatsOf(ctx, "host")) === JSON.stringify({ members: 1, pendingInvites: 0, occupied: 1 }), "seats")], { critical: true });
      const joined = await saas(ctx, "the platform admin joins as support", "POST", `/workspaces/${owner.tenantId}/join`);
      const again = await saas(ctx, "the platform admin joins again", "POST", `/workspaces/${owner.tenantId}/join`);
      await ctx.verify("joining as support takes no seat", [
        check("joined: 200", joined.status === 200 && pick(joined.body, "joined") === true, joined.body),
        check("joining twice: 409 saas.errors.workspace.already_member", again.status === 409 && code(again) === "saas.errors.workspace.already_member", again.body),
        check("the seats are unchanged: 1 member", JSON.stringify(await seatsOf(ctx, "host")) === JSON.stringify({ members: 1, pendingInvites: 0, occupied: 1 }), "seats"),
      ]);
      await fixture(ctx, "an expired invitation", "POST", "/expired-invite", { tenantId: owner.tenantId, email: ctx.email("late"), roleId: role });
      await ctx.verify("an expired invitation takes no seat", [check("0 pending invitations", JSON.stringify(await seatsOf(ctx, "host")) === JSON.stringify({ members: 1, pendingInvites: 0, occupied: 1 }), "seats")]);
      const last = await inviteMember(ctx, "host", ctx.email("last"), role);
      await ctx.verify("the second seat is still invitable, then the plan is full", [
        check("the invitation is accepted", last.answer.status === 200, last.answer.body),
        check("1 member and 1 pending invitation", JSON.stringify(await seatsOf(ctx, "host")) === JSON.stringify({ members: 1, pendingInvites: 1, occupied: 2 }), "seats"),
        check("a third address is refused 409 saas.errors.plan.seat_limit_reached", refusal(await inviteMember(ctx, "host", ctx.email("third"), role)), "third"),
      ]);
    },
  },
  {
    id: "a-cap-lowered-under-the-member-count-keeps-members-and-stops-invitations",
    title: "lowering maxMembers below the members a workspace has keeps their access and refuses new invitations",
    entryPoint: "PUT /api/saas/plans/:id, POST /dms/pages/settings/workspace/members/invite",
    async run(/** @type {Ctx} */ ctx) {
      const plan = await createPlan(ctx, "trio", { maxMembers: 3, permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "chief");
      const role = await createRole(ctx, "chief");
      const member = await joinMember(ctx, "chief", "second", role);
      const third = await joinMember(ctx, "chief", "third", role);
      await ctx.verify("the workspace is full with 3 members", [
        check("both invitations were accepted", member.ok && third.ok, [member.ok, third.ok]),
        check("3 members, no pending invitation", JSON.stringify(await seatsOf(ctx, "chief")) === JSON.stringify({ members: 3, pendingInvites: 0, occupied: 3 }), "seats"),
      ], { critical: true });
      const lowered = await saas(ctx, "lower the cap to 1", "PUT", `/plans/${plan.id}`, { body: { maxMembers: 1 } });
      const stillIn = await saas(ctx, "the third member reads the workspace", "GET", "/workspaces/current/glance", { as: "third" });
      const invite = (await inviteMember(ctx, "chief", ctx.email("more"), role)).answer;
      await ctx.verify("members keep access, new invitations are refused", [
        check("the cap is lowered: 200", lowered.status === 200, lowered.body),
        check("a member beyond the new cap still reads the workspace", stillIn.status === 200, stillIn.body),
        check("the seats still count 3 members", JSON.stringify(await seatsOf(ctx, "chief")) === JSON.stringify({ members: 3, pendingInvites: 0, occupied: 3 }), "seats"),
        check("a new invitation is refused 409 saas.errors.plan.seat_limit_reached", invite.status === 409 && code(invite) === "saas.errors.plan.seat_limit_reached", invite.body),
        check("the owner is unchanged", owner.tenantId !== "", owner.answer.body),
      ]);
      const listed = list((await saas(ctx, "the plans", "GET", "/plans")).body).find((entry) => text(entry, "slug") === "trio");
      await ctx.verify("the catalogue stores the lowered cap", [check("maxMembers is 1", pick(listed, "maxMembers") === 1, listed)]);
    },
  },
];
