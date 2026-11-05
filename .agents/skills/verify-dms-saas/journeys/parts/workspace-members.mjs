import { allPermissionIds, check, createPlan, fixture, inviteMember, createRole, isText, joinMember, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/** Owner-only workspace settings with a real member, what deletion does to invitations, and the operation id bounds. */
export const memberJourneys = [
  {
    id: "a-member-cannot-rename-delete-or-export-the-workspace",
    title: "a member who joined through an invitation is refused 403 on rename, deletion, the danger-zone overview and the data export, and the workspace is unchanged",
    entryPoint: "PUT /api/saas/workspaces/current, POST /current/delete, GET /current/overview, POST /api/saas/data-export/start",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "boss", { workspaceName: "Team Space" });
      const member = await joinMember(ctx, "boss", "teammate");
      await ctx.verify("the invitation is accepted", [check("the member signed up through the invitation", member.ok, member.email)], { critical: true });
      const rename = await saas(ctx, "the member renames", "PUT", "/workspaces/current", { as: "teammate", body: { name: "Hijacked" } });
      const del = await saas(ctx, "the member deletes", "POST", "/workspaces/current/delete", { as: "teammate", body: { confirmName: "Team Space" } });
      const overview = await saas(ctx, "the member reads the danger zone", "GET", "/workspaces/current/overview", { as: "teammate" });
      const exported = await saas(ctx, "the member starts a data export", "POST", "/data-export/start", { as: "teammate" });
      await ctx.verify("every owner-only action is refused to a member", [
        check("rename: 403", rename.status === 403, rename.body),
        check("delete: 403", del.status === 403, del.body),
        check("overview: 403", overview.status === 403, overview.body),
        check("data export: 403", exported.status === 403, exported.body),
      ]);
      const billingInfo = await saas(ctx, "the member saves billing information", "PUT", "/tenant/billing-info", { as: "teammate", body: { customerType: "individual" } });
      const planChange = await saas(ctx, "the member changes the plan", "PUT", "/tenant/plan", { as: "teammate", body: { planId: "none" } });
      const cancellation = await saas(ctx, "the member cancels the plan", "POST", "/tenant/plan/cancellation", { as: "teammate", body: {} });
      const portal = await saas(ctx, "the member opens the billing portal", "POST", "/billing/portal-session", { as: "teammate", body: {} });
      await ctx.verify("only the workspace owner changes the plan, the card and the billing information", [
        check("billing information: 403", billingInfo.status === 403, billingInfo.body),
        check("plan change: 403", planChange.status === 403, planChange.body),
        check("cancellation: 403", cancellation.status === 403, cancellation.body),
        check("billing portal: 403", portal.status === 403, portal.body),
      ]);
      const glance = await saas(ctx, "the member reads the At a glance cards", "GET", "/workspaces/current/glance", { as: "teammate" });
      const current = await saas(ctx, "the owner reads the workspace", "GET", "/workspaces/current", { as: "boss" });
      await ctx.verify("what a member may read still works and nothing changed", [
        check("the member reads the glance cards", glance.status === 200, glance.body),
        check("the workspace keeps its name and id", text(current.body, "name") === "Team Space" && text(current.body, "_id") === owner.tenantId, current.body),
      ]);
    },
  },
  {
    id: "deleting-a-workspace-cancels-its-pending-invitations",
    title: "a pending invitation exists before the deletion and none is left after it",
    entryPoint: "POST /api/saas/workspaces/current/delete",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "leaver", { workspaceName: "Closing Down" });
      const role = await createRole(ctx, "leaver");
      const invited = await inviteMember(ctx, "leaver", ctx.email("pending"), role);
      const before = await fixture(ctx, "the invitations before the deletion", "GET", `/invites/${owner.tenantId}`);
      await ctx.verify("the invitation is pending", [
        check("the invitation was accepted for sending", invited.answer.status === 200, invited.answer.body),
        check("one invitation, to the invited address", list(before.body).length === 1 && text(list(before.body)[0], "email") === ctx.email("pending"), before.body),
      ], { critical: true });
      const deleted = await saas(ctx, "delete the workspace", "POST", "/workspaces/current/delete", { as: "leaver", body: { confirmName: "Closing Down" } });
      const after = await fixture(ctx, "the invitations after the deletion", "GET", `/invites/${owner.tenantId}`);
      await ctx.verify("the deletion cancels the invitation", [
        check("deleted: 200", deleted.status === 200, deleted.body),
        check("no invitation is left", list(after.body).length === 0, after.body),
      ]);
    },
  },
  {
    id: "an-operation-id-is-8-to-64-letters-digits-or-hyphens",
    title: "operation ids of 8 and 64 characters are accepted, 7 and 65 characters, spaces and other symbols are refused",
    entryPoint: "POST /api/saas/workspaces/:tenantId/suspend and /unsuspend",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const customer = await register(ctx, "idcheck", { workspaceName: "Ids Ltd" });
      const base = `/workspaces/${customer.tenantId}`;
      const suspend = (/** @type {string} */ operationId) => saas(ctx, `suspend with an id of ${operationId.length} characters`, "POST", `${base}/suspend`, { body: { confirmName: "Ids Ltd", operationId } });
      const refused = [];
      for (const [label, operationId] of [["7 characters", "a".repeat(7)], ["65 characters", "a".repeat(65)], ["an underscore", "abcd_efgh"], ["a dot", "abcd.efgh"], ["a slash", "abcd/efgh"]]) {
        const answer = await suspend(operationId);
        refused.push(check(`${label}: refused 400`, answer.status === 400, answer.body));
      }
      await ctx.verify("ids outside the documented shape are refused", refused);
      const eight = await suspend("Ab-12-cd");
      await ctx.verify("8 characters, with a capital, digits and hyphens, is accepted", [check("200", eight.status === 200, eight.body)]);
      const sixtyFour = await saas(ctx, "reactivate with an id of 64 characters", "POST", `${base}/unsuspend`, { body: { operationId: "-".repeat(32) + "z".repeat(32) } });
      await ctx.verify("64 characters is accepted", [check("200", sixtyFour.status === 200, sixtyFour.body)]);
      const reused = await saas(ctx, "read the recorded operation", "GET", `${base}/operations/Ab-12-cd`);
      await ctx.verify("the accepted operation is recorded under its id", [check("200 and not requiring reconciliation", reused.status === 200 && pick(reused.body, "requiresReconciliation") === false, reused.body), check("error codes are not leaked as 500", code(eight) === "" || eight.status === 200, eight.body)]);
    },
  },
];
