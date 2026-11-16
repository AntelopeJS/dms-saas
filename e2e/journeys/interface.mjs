import { guarded } from "../guard.mjs";
import { check, createPlan, fixture, pick, register, text } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * Calls one function of the public interface through the fixture.
 *
 * @param {Ctx} ctx The journey
 * @param {"balance" | "preview" | "period"} name The function
 * @param {Record<string, string>} scope The scope sent
 * @returns {Promise<import("../saas.mjs").Answer>} What the interface answered
 */
function call(ctx, name, scope) {
  return fixture(ctx, `${name} of ${JSON.stringify(scope)}`, "POST", `/interface/${name}`, scope);
}

/** The billing functions of @antelopejs/interface-dms-saas, called the way a consuming module calls them. */
export const journeys = guarded([
  {
    id: "the-billing-reads-answer-absent-for-a-free-and-a-gifted-workspace",
    title: "balance and upcoming invoice preview answer absent with the documented reason, the billing period is null, and a non-member is refused",
    entryPoint: "GetTenantCustomerBalance, GetUpcomingInvoicePreview, GetTenantBillingPeriod",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      const pro = await createPlan(ctx, "pro", { price: 20, order: 1 });
      const free = await register(ctx, "free-owner");
      const gift = await register(ctx, "gift-owner");
      const paid = await register(ctx, "paid-owner");
      await fixture(ctx, "gift the pro plan", "POST", "/subscription", { tenantId: gift.tenantId, planId: pro.id, status: "active", isComplimentary: true, stripeCustomerId: "cus_gift" });
      await fixture(ctx, "bill the pro plan", "POST", "/subscription", { tenantId: paid.tenantId, planId: pro.id, status: "active", stripeCustomerId: "cus_iface", stripeSubscriptionId: "sub_iface" });
      const scope = (/** @type {{ tenantId: string, userId: string }} */ who) => ({ tenantId: who.tenantId, userId: who.userId });
      const freeBalance = await call(ctx, "balance", scope(free));
      const giftBalance = await call(ctx, "balance", scope(gift));
      await ctx.verify("the balance is absent, never a zero", [
        check("free workspace: absent, customer_not_configured, null amount and currency", JSON.stringify(pick(freeBalance.body, "result")) === JSON.stringify({ status: "absent", reason: "customer_not_configured", balanceMinorUnits: null, currency: null }), freeBalance.body),
        check("gifted workspace: absent, complimentary", pick(giftBalance.body, "result", "reason") === "complimentary", giftBalance.body),
      ]);
      const freePreview = await call(ctx, "preview", scope(free));
      const giftPreview = await call(ctx, "preview", scope(gift));
      const paidPreview = await call(ctx, "preview", scope(paid));
      await ctx.verify("the upcoming invoice preview says why it has no figures", [
        check("free workspace: absent, free_plan", pick(freePreview.body, "result", "status") === "absent" && pick(freePreview.body, "result", "reason") === "free_plan", freePreview.body),
        check("gifted workspace: absent, complimentary", pick(giftPreview.body, "result", "reason") === "complimentary", giftPreview.body),
        check("billed workspace without a usable Stripe key: unavailable, stripe_not_configured", pick(paidPreview.body, "result", "status") === "unavailable" && pick(paidPreview.body, "result", "reason") === "stripe_not_configured", paidPreview.body),
        check("an absent or unavailable preview carries computedAt", text(pick(paidPreview.body, "result"), "computedAt") !== "" && text(pick(freePreview.body, "result"), "computedAt") !== "", paidPreview.body),
      ]);
      const outsider = await call(ctx, "balance", { tenantId: free.tenantId, userId: gift.userId });
      const outsiderPreview = await call(ctx, "preview", { tenantId: free.tenantId, userId: gift.userId });
      await ctx.verify("a user who is not a member of the workspace is refused", [
        check("balance rejects with error.tenant_member_required", pick(outsider.body, "ok") === false && JSON.stringify(outsider.body).includes("error.tenant_member_required"), outsider.body),
        check("preview rejects too", pick(outsiderPreview.body, "ok") === false, outsiderPreview.body),
      ]);
      const periods = [await call(ctx, "period", { tenantId: free.tenantId }), await call(ctx, "period", { tenantId: gift.tenantId }), await call(ctx, "period", { tenantId: paid.tenantId })];
      await ctx.verify("the billing period is null for a free workspace, a gifted one, and one without a recorded period", [
        check("free", periods[0] && pick(periods[0].body, "ok") === true && pick(periods[0].body, "result") === null, periods[0]?.body),
        check("gifted", periods[1] && pick(periods[1].body, "result") === null, periods[1]?.body),
        check("billed but no recorded period yet", periods[2] && pick(periods[2].body, "result") === null, periods[2]?.body),
      ]);
    },
  },
]);
