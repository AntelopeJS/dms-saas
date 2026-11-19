import { guarded } from "../guard.mjs";
import { check, holdsValue, pick, createPlan, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const SETTINGS = "/settings/billing";

/** Configuration › Billing rules & legal: every rule range and the legal documents. */
export const journeys = guarded([
  {
    id: "saving-a-legal-text-publishes-a-new-version",
    title: "each legal document has its own version, bumped only by a changed text, readable by anyone and shown on its public page",
    entryPoint: "PUT /api/saas/settings/billing, GET /api/saas/legal-documents, /terms-of-use",
    async run(/** @type {Ctx} */ ctx) {
      const read = async (/** @type {string} */ label) => saas(ctx, label, "GET", "/legal-documents", { as: "anon" });
      const versionOf = (/** @type {import("../saas.mjs").Answer} */ answer, /** @type {string} */ key) => pick(answer.body, "versions", key, "version");
      const start = await read("the documents before any save");
      await ctx.verify("no document is published yet", [
        check("the three versions are 0", ["termsOfUse", "termsAndConditions", "privacyPolicy"].every((key) => versionOf(start, key) === 0), start.body),
      ]);
      await saas(ctx, "publish the terms of use", "PUT", SETTINGS, { body: { termsOfUse: "Terms v1" } });
      const first = await read("the documents after the first save");
      await saas(ctx, "save the same terms of use again", "PUT", SETTINGS, { body: { termsOfUse: "Terms v1" } });
      const same = await read("the documents after saving the same text");
      await saas(ctx, "change the terms of use and add a privacy policy", "PUT", SETTINGS, { body: { termsOfUse: "Terms v2", privacyPolicy: "Privacy v1" } });
      const second = await read("the documents after a change");
      await ctx.verify("a changed text bumps only its own document", [
        check("terms of use is version 1, the others 0", versionOf(first, "termsOfUse") === 1 && versionOf(first, "termsAndConditions") === 0 && versionOf(first, "privacyPolicy") === 0, first.body),
        check("the same text is not a new version", versionOf(same, "termsOfUse") === 1, same.body),
        check("terms of use is version 2 and the privacy policy version 1", versionOf(second, "termsOfUse") === 2 && versionOf(second, "privacyPolicy") === 1 && versionOf(second, "termsAndConditions") === 0, second.body),
        check("the texts are stored as saved", text(second.body, "termsOfUse") === "Terms v2" && text(second.body, "privacyPolicy") === "Privacy v1", second.body),
      ]);
      const tab = await ctx.tab("anon");
      await tab.goto("/terms-of-use");
      await ctx.verify("the public terms of use page shows the published text and its version", [
        tab.shows(/Terms v2/, { timeoutMs: 30_000 }),
        tab.shows(/[Vv]ersion 2/, { timeoutMs: 15_000 }),
      ]);
      const tooLong = await saas(ctx, "save a text over 500000 characters", "PUT", SETTINGS, { body: { privacyPolicy: "x".repeat(500_001) } });
      const atLimit = await saas(ctx, "save a text of exactly 500000 characters", "PUT", SETTINGS, { body: { privacyPolicy: "x".repeat(500_000) } });
      await ctx.verify("a legal text is limited to 500000 characters", [
        check("500001 is refused", tooLong.status === 400 && JSON.stringify(tooLong.body).includes("$saas.errors.billing_rules.legal_text_too_long"), tooLong.body),
        check("500000 is accepted", atLimit.status === 200, atLimit.body),
      ]);
    },
  },
  {
    id: "the-platform-owner-saves-a-rule-on-the-billing-rules-page",
    title: "the platform owner changes the days before suspension and the data retention on the page and saves, and a reload and the settings API keep both, and the public pricing facts carry the retention",
    entryPoint: "Configuration › Billing rules & legal, GET /api/saas/settings/billing, GET /api/saas/pricing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const delay = { role: "spinbutton", name: "Days before suspension" };
      const retention = { role: "spinbutton", name: "Keep data after cancellation" };
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/configuration/settings");
      await ctx.verify("the page offers the defaults", [tab.shows(/Unpaid invoices/, { timeoutMs: 60_000 }), holdsValue(tab, delay, "14"), holdsValue(tab, retention, "30")], { critical: true });
      await tab.fill(delay, "7");
      await tab.fill(retention, "90");
      await tab.click({ role: "button", name: "Save changes" });
      await ctx.verify("the save is acknowledged", [tab.shows(/Billing rules saved/, { timeoutMs: 30_000 })], { critical: true });
      await tab.reload();
      await ctx.verify("after a reload the page holds the saved values", [tab.shows(/Unpaid invoices/, { timeoutMs: 60_000 }), holdsValue(tab, delay, "7"), holdsValue(tab, retention, "90")]);
      const stored = await saas(ctx, "the stored rules", "GET", SETTINGS);
      const pricing = await saas(ctx, "the public pricing facts", "GET", "/pricing", { as: "anon" });
      await ctx.verify("the settings API carries both values, the public pricing facts the retention, and the other rules are left alone", [
        check("7 days before suspension and 90 days of retention", pick(stored.body, "autoSuspendDelayDays") === 7 && pick(stored.body, "dataRetentionDaysAfterCancellation") === 90, stored.body),
        check("suspension is still on", pick(stored.body, "autoSuspendEnabled") === true, stored.body),
        check("the customer timeline reads 7 and 90", JSON.stringify(pick(stored.body, "customerTimeline")) === JSON.stringify({ autoSuspendEnabled: true, autoSuspendDelayDays: 7, dataRetentionDaysAfterCancellation: 90 }), stored.body),
        check("the public pricing facts carry the 90 days of retention", pick(pricing.body, "rules", "dataRetentionDays") === 90, pricing.body),
      ]);
    },
  },
]);
