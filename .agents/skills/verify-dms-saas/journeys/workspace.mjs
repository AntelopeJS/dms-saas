import { guarded } from "../guard.mjs";
import { check, createPlan, isText, list, pick, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/** Settings › Workspace: the General page's rename and deletion, the workspace list, and an operator's suspension as the workspace lives it. */
export const journeys = guarded([
  {
    id: "an-owner-renames-the-workspace-and-sees-it-listed",
    title: "the owner renames the workspace (saved trimmed), the switcher list and the General page read the new name, and an anonymous caller cannot rename",
    entryPoint: "PUT /api/saas/workspaces/current, GET /api/saas/workspaces/mine, GET /api/saas/workspaces/current/glance",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const owner = await register(ctx, "renamer", { workspaceName: "Before" });
      const renamed = await saas(ctx, "rename the workspace", "PUT", "/workspaces/current", { as: "renamer", body: { name: "  After the rename  " } });
      const current = await saas(ctx, "the current workspace", "GET", "/workspaces/current", { as: "renamer" });
      const mine = await saas(ctx, "the workspaces of the account", "GET", "/workspaces/mine", { as: "renamer" });
      const glance = await saas(ctx, "the At a glance cards", "GET", "/workspaces/current/glance", { as: "renamer" });
      await ctx.verify("the new name is trimmed and read everywhere", [
        check("the rename answers the trimmed name", renamed.status === 200 && text(renamed.body, "name") === "After the rename", renamed.body),
        check("General reads it", text(current.body, "name") === "After the rename" && text(current.body, "_id") === owner.tenantId, current.body),
        check("the switcher lists exactly this workspace, by its new name", list(mine.body).length === 1 && text(list(mine.body)[0], "name") === "After the rename", mine.body),
        check("the glance cards are members, plan and owner, with 1 seat used, the plan Free and the owner's name", JSON.stringify(list(glance.body, "items").map((item) => [text(item, "id"), isText(item.value) ? item.value : pick(item.value, "params", "occupied", "value")])) === JSON.stringify([["members", 1], ["plan", "free"], ["owner", "Verify renamer"]]), glance.body),
      ]);
      const anonymous = await saas(ctx, "rename without a session", "PUT", "/workspaces/current", { as: "anon", body: { name: "Hijack" } });
      const unchanged = await saas(ctx, "the name after the refused rename", "GET", "/workspaces/current", { as: "renamer" });
      await ctx.verify("an anonymous caller cannot rename", [
        check("401 or 403", anonymous.status === 401 || anonymous.status === 403, anonymous.status),
        check("the name is unchanged", text(unchanged.body, "name") === "After the rename", unchanged.body),
      ]);
    },
  },
  {
    id: "deleting-a-workspace-needs-its-name-and-revokes-access",
    title: "deletion needs the typed workspace name, answers the retention it keeps data for, and closes the workspace to its owner",
    entryPoint: "POST /api/saas/workspaces/current/delete",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "leaver", { workspaceName: "Doomed" });
      const wrong = await saas(ctx, "delete with the wrong name", "POST", "/workspaces/current/delete", { as: "leaver", body: { confirmName: "doomed!" } });
      const missing = await saas(ctx, "delete without a name", "POST", "/workspaces/current/delete", { as: "leaver", body: {} });
      const still = await saas(ctx, "the workspace after the refusals", "GET", "/workspaces/current", { as: "leaver" });
      await ctx.verify("a missing or wrong name deletes nothing", [
        check("wrong: 400 saas.errors.workspace.delete_confirmation_mismatch", wrong.status === 400 && code(wrong) === "saas.errors.workspace.delete_confirmation_mismatch", wrong.body),
        check("missing: 400 saas.errors.workspace.delete_confirmation_mismatch", missing.status === 400 && code(missing) === "saas.errors.workspace.delete_confirmation_mismatch", missing.body),
        check("the workspace is still readable", still.status === 200 && text(still.body, "name") === "Doomed", still.body),
      ]);
      const retention = await saas(ctx, "the retention the page announces", "GET", "/settings/billing");
      const deleted = await saas(ctx, "delete with the exact name (padded)", "POST", "/workspaces/current/delete", { as: "leaver", body: { confirmName: "  Doomed " } });
      const after = await saas(ctx, "rename after the deletion", "PUT", "/workspaces/current", { as: "leaver", body: { name: "Revived" } });
      const listed = await saas(ctx, "the account's workspaces after the deletion", "GET", "/workspaces/mine", { as: "leaver" });
      await ctx.verify("the deletion is accepted and access is revoked at once", [
        check("200", deleted.status === 200, deleted.body),
        check("the default retention is 30 days", pick(retention.body, "dataRetentionDaysAfterCancellation") === 30, retention.body),
        check("the owner can no longer change the workspace", after.status >= 400, after.status),
        check("the switcher shows it cancelled", list(listed.body).some((entry) => text(entry, "name") === "Doomed" && text(entry, "status") === "cancelled"), listed.body),
      ]);
    },
  },
  {
    id: "an-operator-suspension-closes-the-workspace-until-reactivation",
    title: "suspending needs the typed workspace name and an operation id, closes changes but keeps billing readable, repeats idempotently, and reactivation reopens it",
    entryPoint: "POST /api/saas/workspaces/:tenantId/suspend and /unsuspend, GET /workspace-suspended",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const customer = await register(ctx, "suspended", { workspaceName: "Quiet Co" });
      const base = `/workspaces/${customer.tenantId}`;
      const wrong = await saas(ctx, "suspend with the wrong name", "POST", `${base}/suspend`, { body: { confirmName: "Loud Co", operationId: "suspend-wrong-1" } });
      const shortId = await saas(ctx, "suspend with a 7-character operation id", "POST", `${base}/suspend`, { body: { confirmName: "Quiet Co", operationId: "short-1" } });
      const badChars = await saas(ctx, "suspend with an operation id that has spaces", "POST", `${base}/suspend`, { body: { confirmName: "Quiet Co", operationId: "has spaces here" } });
      await ctx.verify("the suspension is refused until it is confirmed and carries a valid operation id", [
        check("wrong name: 400 saas.errors.workspace.confirmation_mismatch", wrong.status === 400 && code(wrong) === "saas.errors.workspace.confirmation_mismatch", wrong.body),
        check("7 characters: 400", shortId.status === 400, shortId.body),
        check("spaces: 400", badChars.status === 400, badChars.body),
      ]);
      const suspended = await saas(ctx, "suspend the workspace", "POST", `${base}/suspend`, { body: { confirmName: "Quiet Co", operationId: "suspend-quiet-1" } });
      const again = await saas(ctx, "suspend again with the same operation", "POST", `${base}/suspend`, { body: { confirmName: "Quiet Co", operationId: "suspend-quiet-1" } });
      const plan = await saas(ctx, "the plan page stays readable", "GET", "/tenant/plan", { as: "suspended" });
      const rename = await saas(ctx, "rename while suspended", "PUT", "/workspaces/current", { as: "suspended", body: { name: "Changed" } });
      await ctx.verify("a suspended workspace keeps its billing page and refuses changes", [
        check("the suspension answers 200", suspended.status === 200, suspended.body),
        check("the same operation id and values repeats without error", again.status === 200, again.body),
        check("the plan page is still readable", plan.status === 200, plan.status),
        check("a rename is refused", rename.status >= 400, rename.body),
      ]);
      const reuse = await saas(ctx, "reuse the operation id for another action", "POST", `${base}/unsuspend`, { body: { operationId: "suspend-quiet-1" } });
      await ctx.verify("an operation id keeps its first action and values", [check("409 saas.errors.operator.idempotency_mismatch", reuse.status === 409 && code(reuse) === "saas.errors.operator.idempotency_mismatch", reuse.body)]);
      const reactivated = await saas(ctx, "reactivate the workspace", "POST", `${base}/unsuspend`, { body: { operationId: "reactivate-quiet-1" } });
      const renamed = await saas(ctx, "rename after reactivation", "PUT", "/workspaces/current", { as: "suspended", body: { name: "Back Again" } });
      await ctx.verify("reactivation reopens the workspace", [
        check("200", reactivated.status === 200, reactivated.body),
        check("a rename works again", renamed.status === 200 && text(renamed.body, "name") === "Back Again", renamed.body),
      ]);
    },
  },
]);
