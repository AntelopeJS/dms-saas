import { deflateSync } from "node:zlib";
import { guarded } from "../guard.mjs";
import { memberJourneys } from "./parts/workspace-members.mjs";
import { allPermissionIds, check, createPlan, isText, list, pick, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

const LOGO_SIZE_PX = 16;

/**
 * A square PNG of one colour, built here so no binary sits in the source.
 *
 * @param {[number, number, number]} rgb The colour
 * @returns {Buffer} The PNG bytes
 */
function solidPng(rgb) {
  /** @type {(type: string, data: Buffer) => Buffer} */
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(LOGO_SIZE_PX, 0);
  header.writeUInt32BE(LOGO_SIZE_PX, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: LOGO_SIZE_PX }, () => Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: LOGO_SIZE_PX }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * @param {Buffer} bytes The bytes
 * @returns {number} Their CRC-32, as PNG chunks carry it
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} url A file URL
 * @returns {Promise<number>} The status it answers
 */
async function fileStatus(url) {
  const answer = await fetch(url);
  return answer.status;
}

/** Settings › Workspace: the General page's logo, rename and deletion, the workspace list, and an operator's suspension as the workspace lives it. */
export const journeys = guarded([
  {
    id: "an-owner-renames-the-workspace-and-sees-it-listed",
    tag: "@smoke",
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
    id: "an-owner-sets-replaces-and-removes-the-workspace-logo",
    title: "the owner uploads, replaces and removes the workspace logo on the General page, the switcher follows each save without a reload, and a replaced or removed file is deleted",
    entryPoint: "Settings › Workspace › General, PUT /api/saas/workspaces/current, GET /api/saas/workspaces/mine",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { name: { en: "Free" }, permissions: await allPermissionIds(ctx) });
      await register(ctx, "brander", { workspaceName: "Logo Co" });
      const switcherLogo = () => saas(ctx, "the switcher's workspaces", "GET", "/workspaces/mine", { as: "brander" });
      const before = await switcherLogo();
      await ctx.verify("a workspace without a logo shows its initial", [check("logoUrl is null", list(before.body).length === 1 && pick(list(before.body)[0], "logoUrl") === null, before.body)]);

      const tab = await ctx.tab("brander");
      await tab.signIn("brander");
      await tab.goto("/settings/workspace/general");
      await ctx.verify("the General page offers the logo field", [tab.shows(/Shown in the workspace switcher/, { timeoutMs: 60_000 })], { critical: true });
      await tab.page.evaluate(() => {
        document.documentElement.dataset.journeyDocument = "kept";
      });
      const trigger = tab.page.locator('button[aria-label="Switch workspace"] img');
      const fileInput = tab.page.locator('input[type="file"]');
      /** @type {(label: string) => Promise<void>} */
      const save = async (label) => {
        await tab.click({ role: "button", name: "Save changes" });
        await ctx.verify(`${label} is saved`, [tab.shows(/Workspace saved\./)], { critical: true });
      };

      await fileInput.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: solidPng([13, 148, 136]) });
      await save("the upload");
      const uploaded = await saas(ctx, "the workspace after the upload", "GET", "/workspaces/current", { as: "brander" });
      const firstKey = text(uploaded.body, "logo", "key");
      const firstUrl = text(list((await switcherLogo()).body)[0], "logoUrl");
      await trigger.waitFor({ state: "visible" }).catch(() => undefined);
      await ctx.verify("the upload is stored and the switcher shows it at once", [
        check("the workspace stores an image key", firstKey.startsWith("workspace-logos/"), uploaded.body),
        check("the switcher lists its URL", firstUrl.endsWith(encodeURIComponent(firstKey)) || firstUrl.endsWith(firstKey), firstUrl),
        check("the switcher draws it", (await trigger.getAttribute("src").catch(() => null)) === firstUrl, firstUrl),
        check("the file answers 200", (await fileStatus(firstUrl)) === 200, firstUrl),
      ]);

      await fileInput.setInputFiles({ name: "second.png", mimeType: "image/png", buffer: solidPng([234, 88, 12]) });
      await save("the replacement");
      const secondUrl = text(list((await switcherLogo()).body)[0], "logoUrl");
      await tab.page.waitForFunction((url) => document.querySelector('button[aria-label="Switch workspace"] img')?.getAttribute("src") === url, secondUrl).catch(() => undefined);
      await ctx.verify("the replacement takes the logo's place and deletes the old file", [
        check("the switcher lists another URL", secondUrl !== "" && secondUrl !== firstUrl, secondUrl),
        check("the switcher draws it", (await trigger.getAttribute("src").catch(() => null)) === secondUrl, secondUrl),
        check("the replaced file answers 404", (await fileStatus(firstUrl)) === 404, firstUrl),
      ]);

      await tab.click({ role: "button", name: "Delete", exact: true });
      await save("the removal");
      const removed = await saas(ctx, "the workspace after the removal", "GET", "/workspaces/current", { as: "brander" });
      const after = await switcherLogo();
      await ctx.verify("the removal brings the initial back and deletes the file", [
        check("the workspace stores no logo", pick(removed.body, "logo") === null, removed.body),
        check("the switcher lists no URL", pick(list(after.body)[0], "logoUrl") === null, after.body),
        tab.visible({ role: "button", name: "Switch workspace" }),
        check("the switcher draws no image", (await trigger.count()) === 0, await trigger.count()),
        check("the removed file answers 404", (await fileStatus(secondUrl)) === 404, secondUrl),
        check("every save kept the same document", (await tab.page.evaluate(() => document.documentElement.dataset.journeyDocument)) === "kept", "the marker set on the document before the first save"),
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
  ...memberJourneys,
]);
