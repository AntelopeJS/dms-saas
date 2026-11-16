import { allPermissionIds, check, createPlan, createRole, fixture, inviteMember, isText, joinMember, list, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const SIGNUP_LINK = /\/auth\/signup\?token=([^&\s]+)/;

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/** Internal notes, resending an invitation, the audit trail of an operation, and data export. */
export const opsAuditJourneys = [
  {
    id: "internal-notes-are-the-platform-owners-and-nobody-elses",
    title: "the platform owner writes, reads and deletes a note on a workspace; an empty note is refused; the workspace owner, a member and an anonymous caller get nothing",
    entryPoint: "/api/saas/platform-notes/:targetType/:targetId",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "noted", { workspaceName: "Noted Co" });
      const member = await joinMember(ctx, "noted", "noted-member");
      const base = `/platform-notes/workspace/${owner.tenantId}`;
      const written = await saas(ctx, "write a note", "POST", base, { body: { content: "  Watch this account  " } });
      const empty = await saas(ctx, "write an empty note", "POST", base, { body: { content: "   " } });
      const listed = await saas(ctx, "read the notes", "GET", base);
      const items = list(listed.body, "items");
      await ctx.verify("the platform owner keeps notes, saved trimmed", [
        check("write: 200, content trimmed, authored by the platform owner", written.status === 200 && text(written.body, "content") === "Watch this account", written.body),
        check("an empty note is refused 400", empty.status === 400, empty.body),
        check("the list holds the one note", items.length === 1 && text(items[0], "content") === "Watch this account", listed.body),
      ]);
      const refusals = [];
      for (const who of ["noted", "noted-member", "anon"]) {
        const read = await saas(ctx, `${who} reads the notes`, "GET", base, { as: who });
        const write = await saas(ctx, `${who} writes a note`, "POST", base, { as: who, body: { content: "I can write too" } });
        const remove = await saas(ctx, `${who} deletes the note`, "DELETE", `/platform-notes/${text(written.body, "_id")}`, { as: who });
        const refused = (/** @type {number | null} */ status) => status === 401 || status === 403;
        refusals.push(check(`${who}: read refused`, refused(read.status), read.status), check(`${who}: write refused`, refused(write.status), write.status), check(`${who}: delete refused`, refused(remove.status), remove.status));
      }
      const after = await saas(ctx, "read the notes after the refusals", "GET", base);
      await ctx.verify("a workspace owner, a member and an anonymous caller can neither read, write nor delete", [check("the member joined", member.ok, member.email), ...refusals, check("the note is untouched", list(after.body, "items").length === 1, after.body)]);
      const removed = await saas(ctx, "the platform owner deletes the note", "DELETE", `/platform-notes/${text(written.body, "_id")}`);
      const gone = await saas(ctx, "read the notes once deleted", "GET", base);
      await ctx.verify("the platform owner deletes it", [check("200 and no note left", removed.status === 200 && list(gone.body, "items").length === 0, gone.body)]);
    },
  },
  {
    id: "resending-an-invitation-issues-a-new-link-and-kills-the-old-one",
    title: "Resend mails a new link with a later expiry; the new link signs the invitee up and the previous link is refused",
    entryPoint: "POST /api/saas/workspaces/:tenantId/invitations/:inviteId/resend",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "resender");
      const role = await createRole(ctx, "resender");
      const email = ctx.email("invitee");
      const first = await inviteMember(ctx, "resender", email, role);
      const before = list((await fixture(ctx, "the invitations before", "GET", `/invites/${owner.tenantId}`)).body);
      const resent = await saas(ctx, "resend the invitation", "POST", `/workspaces/${owner.tenantId}/invitations/${text(before[0], "id")}/resend`);
      const mail = await ctx.mail((message) => message.to.some((to) => to.includes(email)) && message.links.some((link) => SIGNUP_LINK.test(link) && !link.includes(first.token)));
      const link = mail.match?.links.findLast((entry) => SIGNUP_LINK.test(entry) && !entry.includes(first.token)) ?? "";
      const newToken = SIGNUP_LINK.exec(link)?.[1] ?? "";
      const after = list((await fixture(ctx, "the invitations after", "GET", `/invites/${owner.tenantId}`)).body);
      await ctx.verify("the resend answers sent with a later expiry and mails a new link", [
        check("200 with emailDelivery sent", resent.status === 200 && text(resent.body, "emailDelivery") === "sent", resent.body),
        check("a new link arrived, different from the first", first.token !== "" && newToken !== "" && newToken !== first.token, [first.token, newToken]),
        check("one invitation remains for the address", after.length === 1 && text(after[0], "email") === email, after),
        check("its expiry is not earlier than before", new Date(text(after[0], "expiresAt")).getTime() >= new Date(text(before[0], "expiresAt")).getTime(), [before[0], after[0]]),
      ]);
      const password = ctx.password();
      const old = await ctx.api("sign up with the old link", { method: "POST", path: "/api/auth/signup", as: "anon", body: { name: "Invitee", email, password, token: first.token } });
      const fresh = await ctx.api("sign up with the new link", { method: "POST", path: "/api/auth/signup", as: "anon", body: { name: "Invitee", email, password, token: newToken } });
      await ctx.verify("only the new link signs the invitee up", [check("the old link is refused", old.status >= 400, old.body), check("the new link creates the account", fresh.status === 200, fresh.body)]);
    },
  },
  {
    id: "an-operator-action-leaves-an-audit-trail-and-its-id-cannot-be-reused-elsewhere",
    title: "a suspension is recorded as a succeeded operation with its action, listed once under the lifecycle activity and not under billing, and reusing its id for another workspace is a 409 idempotency mismatch",
    entryPoint: "GET /api/saas/workspaces/:tenantId/operations/:operationId, GET /api/saas/dashboard/activity",
    async run(/** @type {Ctx} */ ctx) {
      const free = await createPlan(ctx, "free");
      const first = await register(ctx, "audited", { workspaceName: "Audit Co" });
      const second = await register(ctx, "other", { workspaceName: "Other Co" });
      await fixture(ctx, "free subscription", "POST", "/subscription", { tenantId: first.tenantId, planId: free.id, status: "active" });
      const suspended = await saas(ctx, "suspend", "POST", `/workspaces/${first.tenantId}/suspend`, { body: { confirmName: "Audit Co", operationId: "audit-trail-0001" } });
      const record = await saas(ctx, "the operation record", "GET", `/workspaces/${first.tenantId}/operations/audit-trail-0001`);
      const elsewhere = await saas(ctx, "the same id for another workspace", "POST", `/workspaces/${second.tenantId}/suspend`, { body: { confirmName: "Other Co", operationId: "audit-trail-0001" } });
      const wrongTenant = await saas(ctx, "read the operation under another workspace", "GET", `/workspaces/${second.tenantId}/operations/audit-trail-0001`);
      await ctx.verify("the operation is recorded and its id is tied to its workspace", [
        check("suspended: 200", suspended.status === 200, suspended.body),
        check("the record: succeeded, workspace.suspend, no reconciliation needed", text(record.body, "status") === "succeeded" && text(record.body, "action") === "workspace.suspend" && pick(record.body, "requiresReconciliation") === false, record.body),
        check("the same id for another workspace: 409 saas.errors.operator.idempotency_mismatch", elsewhere.status === 409 && code(elsewhere) === "saas.errors.operator.idempotency_mismatch", elsewhere.body),
        check("another workspace cannot read it: 404", wrongTenant.status === 404, wrongTenant.body),
      ]);
      const lifecycle = await saas(ctx, "recent activity, lifecycle", "GET", "/dashboard/activity?kind=lifecycle");
      const billing = await saas(ctx, "recent activity, billing", "GET", "/dashboard/activity?kind=billing");
      const all = await saas(ctx, "recent activity, all", "GET", "/dashboard/activity");
      const suspensions = (/** @type {import("../../saas.mjs").Answer} */ answer) => list(answer.body, "items").filter((entry) => text(entry, "title") === "$saas.activity.platform.workspace_suspended");
      await ctx.verify("the suspension is listed once under Lifecycle and All, and not under Billing", [
        check("lifecycle: once", suspensions(lifecycle).length === 1, lifecycle.body),
        check("all: once", suspensions(all).length === 1, all.body),
        check("billing: never", suspensions(billing).length === 0, billing.body),
        check("the entry names the workspace", pick(suspensions(lifecycle)[0], "params", "workspace") === "Audit Co", suspensions(lifecycle)),
      ]);
    },
  },
  {
    id: "a-second-data-export-is-refused-while-one-is-running",
    title: "a workspace owner starts an export; asking for another before it finishes is refused 409, and a member cannot start one",
    entryPoint: "POST /api/saas/data-export/start",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { permissions: await allPermissionIds(ctx) });
      await register(ctx, "exporter", { workspaceName: "Export Co" });
      const member = await joinMember(ctx, "exporter", "export-member");
      const memberTry = await saas(ctx, "a member starts an export", "POST", "/data-export/start", { as: "export-member" });
      const firstExport = await saas(ctx, "the first export", "POST", "/data-export/start", { as: "exporter" });
      const secondExport = await saas(ctx, "the second export", "POST", "/data-export/start", { as: "exporter" });
      const results = [firstExport, secondExport];
      const statuses = results.map((answer) => Number(answer.status)).sort((left, right) => left - right);
      await ctx.verify("one export at a time", [
        check("the member joined and is refused 403", member.ok && memberTry.status === 403, memberTry.body),
        check("the first request starts (200) and the second, made while it runs, is refused (409)", JSON.stringify(statuses) === JSON.stringify([200, 409]), results.map((answer) => answer.body)),
        check("the refusal is saas.errors.data_export.already_running", results.some((answer) => answer.status === 409 && code(answer) === "saas.errors.data_export.already_running"), results.map((answer) => answer.body)),
      ]);
    },
  },
];
