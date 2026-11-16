import { check, createPlan, fixture, isText, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const USERS_PAGE = "/modules/saas/customers/users";
const CSV_HEADER = "user_id,email,name,language,created_at,is_validated,workspaces,owned_workspaces,owned_mrr";

/**
 * Starts an owners export of a segment and reads the file once it is built.
 *
 * @param {Ctx} ctx The journey
 * @param {string} segmentId The segment
 * @returns {Promise<string[]>} The CSV lines, header first
 */
async function exportedLines(ctx, segmentId) {
  const started = await saas(ctx, "start the owners export", "POST", `/segments/${segmentId}/owners-export/start`);
  const jobId = text(started.body, "jobId");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await saas(ctx, "export status", "GET", `/segments/${segmentId}/owners-export/status/${jobId}`);
    if (text(status.body, "status") === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const file = await saas(ctx, "download the export", "GET", `/segments/${segmentId}/owners-export/download/${jobId}`);
  return isText(file.body) ? file.body.replace(/^﻿/, "").split("\r\n").filter((line) => line !== "") : [];
}

/** The Users list tabs and the segment CSV export. */
export const peopleMoreJourneys = [
  {
    id: "the-all-and-platform-admins-tabs-list-exactly-their-accounts",
    title: "All lists every account and Platform admins only the admins, each tab with its count",
    entryPoint: "Customers › Users",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "plain-one");
      await register(ctx, "plain-two");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(USERS_PAGE);
      await ctx.verify("the tabs carry their counts", [tab.visible({ role: "button", name: "All 3" }, { timeoutMs: 60_000 }), tab.visible({ role: "button", name: "Platform admins 1" }, { timeoutMs: 15_000 })]);
      await ctx.verify("All lists the three accounts", [tab.shows(/plain-one/, { timeoutMs: 30_000 }), tab.shows(/plain-two/, { timeoutMs: 15_000 }), tab.shows(/Platform admin/, { timeoutMs: 15_000 })]);
      await tab.click({ role: "button", name: "Platform admins 1" });
      await ctx.verify("Platform admins lists the admin and neither visitor", [tab.shows(/Verify admin/i, { timeoutMs: 30_000 }), tab.count({ role: "row", name: /plain-one/ }, 0), tab.count({ role: "row", name: /plain-two/ }, 0)]);
    },
  },
  {
    id: "the-unverified-tab-lists-the-accounts-whose-address-is-not-verified",
    title: "accounts that registered and never verified their e-mail address are listed under Unverified, which counts them",
    entryPoint: "Customers › Users",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "unverified-one");
      await register(ctx, "unverified-two");
      const unverified = await fixture(ctx, "an account that never verified", "POST", "/account-without-workspace", { email: ctx.email("never"), name: "Never Verified", password: ctx.password() });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(USERS_PAGE);
      await ctx.verify("the Unverified tab counts the three accounts that never verified", [
        check("the fixture made an account", text(unverified.body, "userId") !== "", unverified.body),
        tab.visible({ role: "button", name: "Unverified 3" }, { timeoutMs: 60_000 }),
      ]);
      await tab.click({ role: "button", name: /^Unverified/ });
      await ctx.verify("and lists them", [tab.shows(/unverified-one/, { timeoutMs: 30_000 }), tab.shows(/unverified-two/, { timeoutMs: 15_000 }), tab.shows(/never/i, { timeoutMs: 15_000 })]);
    },
  },
  {
    id: "the-segment-export-writes-one-row-per-matching-user-with-owned-mrr",
    title: "the CSV has the documented header, one row per matching user sorted by e-mail, and owned_mrr sums the MRR of the workspaces the user owns",
    entryPoint: "POST /api/saas/segments/:id/owners-export/start",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { order: 0 });
      const pro = await createPlan(ctx, "pro", { price: 50, order: 1 });
      const payer = await register(ctx, "csv-payer", { workspaceName: "Payer Co" });
      const freebie = await register(ctx, "csv-free", { workspaceName: "Free Co" });
      await fixture(ctx, "bill the payer", "POST", "/subscription", { tenantId: payer.tenantId, planId: pro.id, status: "active", stripeCustomerId: "cus_csv", stripeSubscriptionId: "sub_csv" });
      await fixture(ctx, "publish the free workspace", "POST", "/recompute", { tenantId: freebie.tenantId });
      const segment = await saas(ctx, "create the segment", "POST", "/segments", { body: { name: "CSV owners", conditions: { logical: "and", conditions: [{ field: "email", operator: "contains", value: "csv-" }] } } });
      const lines = await exportedLines(ctx, text(segment.body, "_id"));
      const rows = lines.slice(1).map((line) => line.split(","));
      await ctx.verify("header and rows", [
        check("the header", lines[0] === CSV_HEADER, lines[0]),
        check("two rows, sorted by e-mail", rows.length === 2 && rows[0][1] === freebie.email && rows[1][1] === payer.email, lines),
        check("names and verification flag", rows[1]?.[2] === "Verify csv-payer" && rows[1]?.[5] === "false", rows[1]),
        check("workspaces and owned workspaces", rows[1]?.[6] === "Payer Co" && rows[1]?.[7] === "Payer Co", rows[1]),
        check("owned_mrr of the payer: 50.00", rows[1]?.[8] === "50.00", rows[1]),
        check("owned_mrr of the free workspace's owner: 0.00", rows[0]?.[8] === "0.00", rows[0]),
      ]);
      const noSegment = await saas(ctx, "export a segment that does not exist", "POST", "/segments/no-such-segment/owners-export/start");
      await ctx.verify("an unknown segment is 404", [check("404", noSegment.status === 404, noSegment.body), check("owner-only: pick of the segment id", pick(segment.body, "estimatedCount") === 2, segment.body)]);
    },
  },
];
