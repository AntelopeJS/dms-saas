import { check, createPlan, isText, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {import("../../saas.mjs").Answer} answer An API answer
 * @returns {string} The error code or message key
 */
function code(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/** Billing › Invoices and Credit notes: what the module answers without a usable Stripe key. */
export const invoiceJourneys = [
  {
    id: "issuing-a-credit-note-without-stripe-is-refused-before-any-call",
    title: "the credit note preview and issue answer 503 saas.errors.stripe.not_configured, an invalid body is refused first, and only the platform owner may call them",
    entryPoint: "GET /api/saas/credit-notes/preview/:invoiceId, POST /api/saas/credit-notes/issue",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "payer");
      const preview = await saas(ctx, "preview a credit note", "GET", "/credit-notes/preview/in_none");
      const issue = await saas(ctx, "issue a credit note", "POST", "/credit-notes/issue", { body: { invoiceId: "in_none", amount: 100, mode: "credit_to_balance", reason: "goodwill", requestId: "req-credit-1" } });
      await ctx.verify("without a usable key both answer 503 before any journal entry", [
        check("preview: 503 saas.errors.stripe.not_configured", preview.status === 503 && code(preview) === "saas.errors.stripe.not_configured", preview.body),
        check("issue: 503 saas.errors.stripe.not_configured", issue.status === 503 && code(issue) === "saas.errors.stripe.not_configured", issue.body),
      ]);
      const bad = await saas(ctx, "issue with an amount of zero", "POST", "/credit-notes/issue", { body: { invoiceId: "in_none", amount: 0, mode: "credit_to_balance", reason: "goodwill", requestId: "req-credit-2" } });
      const mode = await saas(ctx, "issue with an unknown mode", "POST", "/credit-notes/issue", { body: { invoiceId: "in_none", amount: 100, mode: "cash", reason: "goodwill", requestId: "req-credit-3" } });
      const memo = await saas(ctx, "issue with a very long memo", "POST", "/credit-notes/issue", { body: { invoiceId: "in_none", amount: 100, mode: "credit_to_balance", reason: "goodwill", requestId: "req-credit-4", memo: "m".repeat(5000) } });
      await ctx.verify("a malformed request is refused 400 before the Stripe check", [
        check("amount 0: 400", bad.status === 400 && JSON.stringify(bad.body).includes("$saas.errors.credit_note.amount_positive"), bad.body),
        check("unknown mode: 400", mode.status === 400, mode.body),
        check("memo over the limit: 400", memo.status === 400 && JSON.stringify(memo.body).includes("$saas.errors.credit_note.memo_too_long"), memo.body),
      ]);
      const owner = await saas(ctx, "a workspace owner previews", "GET", "/credit-notes/preview/in_none", { as: "payer" });
      const anon = await saas(ctx, "an anonymous caller issues", "POST", "/credit-notes/issue", { as: "anon", body: { invoiceId: "in_none", amount: 100, mode: "credit_to_balance", reason: "goodwill", requestId: "req-credit-5" } });
      await ctx.verify("only the platform owner reaches the credit notes", [
        check("a workspace owner: 401 or 403", owner.status === 401 || owner.status === 403, owner.status),
        check("anonymous: 401 or 403", anon.status === 401 || anon.status === 403, anon.status),
      ]);
    },
  },
];
