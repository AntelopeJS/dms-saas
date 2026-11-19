import { deflateSync } from "node:zlib";
import { guarded } from "../guard.mjs";
import { memberJourneys } from "./parts/workspace-members.mjs";
import { allPermissionIds, check, createPlan, holdsValue, list, pick, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const LOGO_SIZE_PX = 16;

/**
 * A square PNG of one colour.
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
    id: "an-owner-renames-the-workspace-on-the-general-page-and-the-switcher-follows",
    title: "the owner types a new name on the General page and saves it, and after a reload the form, the switcher and the workspace list read it",
    entryPoint: "Settings › Workspace › General, PUT /api/saas/workspaces/current, GET /api/saas/workspaces/mine",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { name: { en: "Free" }, permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "form-renamer", { workspaceName: "Before Co" });
      const tab = await ctx.tab("form-renamer");
      await tab.signIn("form-renamer");
      await tab.goto("/settings/workspace/general");
      await ctx.verify("the General page offers the name field with the current name", [tab.shows(/Shown in the workspace switcher/, { timeoutMs: 60_000 }), holdsValue(tab, { role: "textbox", name: "Workspace name" }, "Before Co")], { critical: true });
      await tab.fill({ role: "textbox", name: "Workspace name" }, "After Co");
      await tab.click({ role: "button", name: "Save changes" });
      await ctx.verify("the save is acknowledged", [tab.shows(/Workspace saved\./, { timeoutMs: 30_000 })], { critical: true });
      await tab.reload();
      await ctx.verify("after a reload the page draws the new name", [tab.shows(/Download a full copy of After Co before deleting it/, { timeoutMs: 60_000 }), holdsValue(tab, { role: "textbox", name: "Workspace name" }, "After Co")]);
      const switcher = await tab.locator({ role: "button", name: "Switch workspace" }).innerText();
      const mine = await saas(ctx, "the workspaces of the account", "GET", "/workspaces/mine", { as: "form-renamer" });
      const current = await saas(ctx, "the current workspace", "GET", "/workspaces/current", { as: "form-renamer" });
      await ctx.verify("the switcher, the workspace list and the API read the new name", [
        check("the switcher draws After Co and not Before Co", switcher.includes("After Co") && !switcher.includes("Before Co"), switcher),
        check("the list holds this workspace only, as After Co", list(mine.body).length === 1 && text(list(mine.body)[0], "name") === "After Co", mine.body),
        check("the current workspace keeps its id under the new name", text(current.body, "_id") === owner.tenantId && text(current.body, "name") === "After Co", current.body),
      ]);
    },
  },
  ...memberJourneys,
]);
