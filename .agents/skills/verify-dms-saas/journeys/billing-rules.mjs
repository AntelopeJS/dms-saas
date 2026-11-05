import { guarded } from "../guard.mjs";
import { check, pick, createPlan, register, saas, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

const SETTINGS = "/settings/billing";

/**
 * Saves one rule and returns the check for the answer.
 *
 * @param {Ctx} ctx The journey
 * @param {string} key The rule
 * @param {unknown} value The value to save
 * @param {boolean} accepted Whether the value is inside the documented range
 * @param {string} message The message key an out-of-range value is refused with
 * @returns {Promise<import("../saas.mjs").Check>} The check
 */
async function rule(ctx, key, value, accepted, message) {
  const answer = await saas(ctx, `save ${key} = ${JSON.stringify(value)}`, "PUT", SETTINGS, { body: { [key]: value } });
  const refusedWithMessage = answer.status === 400 && JSON.stringify(answer.body).includes(message);
  return check(`${key} = ${JSON.stringify(value)} is ${accepted ? "accepted (200)" : `refused (400 ${message})`}`, accepted ? answer.status === 200 : refusedWithMessage, answer.body);
}

/** Configuration › Billing rules & legal: every rule range and the legal documents. */
export const journeys = guarded([
  {
    id: "every-rule-is-held-to-its-documented-range",
    title: "the suspension delay, the retention, the free workspaces per card, the refund window and the tax code are held to their ranges at both ends",
    entryPoint: "PUT /api/saas/settings/billing",
    async run(/** @type {Ctx} */ ctx) {
      const days = "$saas.errors.billing_rules.suspension_days";
      const retention = "$saas.errors.billing_rules.retention_days";
      const perCard = "$saas.errors.billing_rules.free_workspaces_per_card";
      const window = "$saas.errors.billing_rules.refund_window_days";
      const tax = "$saas.errors.billing_rules.tax_code";
      await ctx.verify("days before suspension: 1 to 365", [
        await rule(ctx, "autoSuspendDelayDays", 0, false, days),
        await rule(ctx, "autoSuspendDelayDays", 1, true, days),
        await rule(ctx, "autoSuspendDelayDays", 365, true, days),
        await rule(ctx, "autoSuspendDelayDays", 366, false, days),
        await rule(ctx, "autoSuspendDelayDays", 1.5, false, days),
      ]);
      await ctx.verify("data retention after cancellation: 0 to 3650", [
        await rule(ctx, "dataRetentionDaysAfterCancellation", -1, false, retention),
        await rule(ctx, "dataRetentionDaysAfterCancellation", 0, true, retention),
        await rule(ctx, "dataRetentionDaysAfterCancellation", 3650, true, retention),
        await rule(ctx, "dataRetentionDaysAfterCancellation", 3651, false, retention),
      ]);
      await ctx.verify("free workspaces per card: 0 to 100", [
        await rule(ctx, "maxFreeWorkspacesPerCard", -1, false, perCard),
        await rule(ctx, "maxFreeWorkspacesPerCard", 0, true, perCard),
        await rule(ctx, "maxFreeWorkspacesPerCard", 100, true, perCard),
        await rule(ctx, "maxFreeWorkspacesPerCard", 101, false, perCard),
      ]);
      await ctx.verify("money-back window: 1 to 365", [
        await rule(ctx, "moneyBackGuaranteeWindowDays", 0, false, window),
        await rule(ctx, "moneyBackGuaranteeWindowDays", 1, true, window),
        await rule(ctx, "moneyBackGuaranteeWindowDays", 365, true, window),
        await rule(ctx, "moneyBackGuaranteeWindowDays", 366, false, window),
      ]);
      await ctx.verify("the refund amount is Full amount or Prorated", [
        await rule(ctx, "moneyBackGuaranteeMode", "full", true, ""),
        await rule(ctx, "moneyBackGuaranteeMode", "prorated", true, ""),
        check("another mode is refused", (await saas(ctx, "save a half refund", "PUT", SETTINGS, { body: { moneyBackGuaranteeMode: "half" } })).status === 400, "half"),
      ]);
      await ctx.verify("the tax category is txcd_ followed by exactly 8 digits", [
        await rule(ctx, "stripeTaxCode", "txcd_12345678", true, tax),
        await rule(ctx, "stripeTaxCode", "txcd_1234567", false, tax),
        await rule(ctx, "stripeTaxCode", "txcd_123456789", false, tax),
        await rule(ctx, "stripeTaxCode", "TXCD_12345678", false, tax),
        await rule(ctx, "stripeTaxCode", "txcd_1234567a", false, tax),
      ]);
      const stored = await saas(ctx, "read the rules back", "GET", SETTINGS);
      await ctx.verify("a refused value changed nothing: the last accepted value of each rule is stored", [
        check("autoSuspendDelayDays 365", pick(stored.body, "autoSuspendDelayDays") === 365, stored.body),
        check("dataRetentionDaysAfterCancellation 3650", pick(stored.body, "dataRetentionDaysAfterCancellation") === 3650, stored.body),
        check("maxFreeWorkspacesPerCard 100", pick(stored.body, "maxFreeWorkspacesPerCard") === 100, stored.body),
        check("stripeTaxCode txcd_12345678", text(stored.body, "stripeTaxCode") === "txcd_12345678", stored.body),
      ]);
    },
  },
  {
    id: "a-save-keeps-what-it-leaves-out-and-reaches-the-public",
    title: "a partial save keeps the other rules, survives a restart, shows in the customer timeline and in the public pricing facts",
    entryPoint: "PUT /api/saas/settings/billing, GET /api/saas/pricing",
    async run(/** @type {Ctx} */ ctx) {
      const before = await saas(ctx, "the defaults", "GET", SETTINGS);
      await ctx.verify("the module defaults", [
        check("suspension on, 14 days", text(before.body, "customerTimeline", "autoSuspendDelayDays") === "" && JSON.stringify(pick(before.body, "customerTimeline")) === JSON.stringify({ autoSuspendEnabled: true, autoSuspendDelayDays: 14, dataRetentionDaysAfterCancellation: 30 }), before.body),
        check("no free workspaces per card, no guarantee, full refund, 14-day window", JSON.stringify([pick(before.body, "maxFreeWorkspacesPerCard"), pick(before.body, "moneyBackGuaranteeEnabled"), text(before.body, "moneyBackGuaranteeMode"), pick(before.body, "moneyBackGuaranteeWindowDays")]) === JSON.stringify([0, false, "full", 14]), before.body),
        check("tax category txcd_10000000", text(before.body, "stripeTaxCode") === "txcd_10000000", before.body),
      ]);
      const saved = await saas(ctx, "save two rules", "PUT", SETTINGS, { body: { autoSuspendDelayDays: 7, dataRetentionDaysAfterCancellation: 90 } });
      await ctx.verify("the save answers 200", [check("200", saved.status === 200, saved.body)], { critical: true });
      await ctx.restartBackend();
      const after = await saas(ctx, "the rules after a restart", "GET", SETTINGS);
      const timeline = pick(after.body, "customerTimeline");
      await ctx.verify("the two rules persist and the others kept their value", [
        check("customer timeline 7 days and 90 days, suspension still on", JSON.stringify(timeline) === JSON.stringify({ autoSuspendEnabled: true, autoSuspendDelayDays: 7, dataRetentionDaysAfterCancellation: 90 }), timeline),
        check("tax category untouched", text(after.body, "stripeTaxCode") === "txcd_10000000", after.body),
      ]);
      const off = await saas(ctx, "turn suspension off", "PUT", SETTINGS, { body: { autoSuspendEnabled: false, moneyBackGuaranteeEnabled: true, moneyBackGuaranteeWindowDays: 30, moneyBackGuaranteeMode: "prorated", maxFreeWorkspacesPerCard: 2 } });
      await createPlan(ctx, "free");
      const pricing = await saas(ctx, "public pricing facts", "GET", "/pricing", { as: "anon" });
      const rules = pick(pricing.body, "rules");
      await ctx.verify("the public pricing facts follow the rules", [
        check("the save answers 200", off.status === 200, off.body),
        check("retention, free workspaces per card and the guarantee", JSON.stringify(rules) === JSON.stringify({ moneyBackGuarantee: { windowDays: 30, mode: "prorated" }, dataRetentionDays: 90, maxFreeWorkspacesPerCard: 2 }), rules),
      ]);
    },
  },
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
    id: "only-the-platform-owner-edits-the-rules",
    title: "a workspace owner and an anonymous caller cannot read or save the billing rules",
    entryPoint: "GET and PUT /api/saas/settings/billing",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const owner = await register(ctx, "tenant-owner");
      const checks = [];
      for (const [who, label] of [["tenant-owner", "a workspace owner"], ["anon", "an anonymous caller"]]) {
        const read = await saas(ctx, `${label} reads the rules`, "GET", SETTINGS, { as: who });
        const write = await saas(ctx, `${label} saves a rule`, "PUT", SETTINGS, { as: who, body: { autoSuspendDelayDays: 3 } });
        checks.push(check(`${label} cannot read`, read.status === 401 || read.status === 403, read.status));
        checks.push(check(`${label} cannot save`, write.status === 401 || write.status === 403, write.status));
      }
      const stored = await saas(ctx, "the rules after the refused saves", "GET", SETTINGS);
      checks.push(check("the delay is still 14", JSON.stringify(pick(stored.body, "customerTimeline")).includes('"autoSuspendDelayDays":14'), stored.body));
      await ctx.verify("only the platform owner reads and saves", [check("the workspace owner registered", owner.tenantId !== "", owner.answer.body), ...checks]);
    },
  },
]);
