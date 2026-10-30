import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantBillingInfoModel, TenantSubscriptionModel } from "../src/db";
import { previewManualUpgrade } from "../src/operator-actions/upgrade-preview";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { insertTenant, seatMembers } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-upgrade-preview");
const stripe = useSuiteStripe();

const PERIOD_END = new Date("2026-10-31T00:00:00Z");

const BUSINESS_TERMS = {
  audience: "any",
  billingMode: "seat",
  maxMembers: 50,
} as const;

beforeAll(async () => {
  await insertPlan({
    ...BUSINESS_TERMS,
    _id: "plan_business",
    name: "Business",
    price: 49,
    paymentProviderRefs: { stripePriceId: "price_business" },
  });
  await insertPlan({
    ...BUSINESS_TERMS,
    _id: "plan_enterprise",
    name: "Enterprise",
    price: 828,
    interval: "year",
    paymentProviderRefs: { stripePriceId: "price_enterprise" },
  });
  await insertPlan({
    ...BUSINESS_TERMS,
    _id: "plan_team",
    name: "Team",
    price: 29,
    paymentProviderRefs: { stripePriceId: "price_team" },
  });
  await insertPlan({
    ...BUSINESS_TERMS,
    _id: "plan_starter",
    name: "Starter",
    price: 9,
    paymentProviderRefs: { stripePriceId: "price_starter" },
  });
});

async function seedWorkspace(planId: string): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await seatMembers(tenantId, 23);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId,
    status: "active",
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    currentPeriodEnd: PERIOD_END,
  });
  await GetModel(TenantBillingInfoModel, tenantId).insert({
    _id: tenantId,
    customerType: "business",
    updatedAt: new Date(),
  });
  return tenantId;
}

function stripePreview() {
  return {
    currency: "eur",
    lines: {
      has_more: false,
      data: [
        {
          description: "Remaining time on Enterprise",
          amount: 1_904_400,
          taxes: [],
          quantity: 23,
          period: { start: 1_790_000_000, end: 1_800_000_000 },
          parent: { subscription_item_details: { proration: true } },
          metadata: {},
        },
        {
          description: "Unused time on Business",
          amount: -109_285,
          taxes: [],
          quantity: 23,
          period: { start: 1_790_000_000, end: 1_800_000_000 },
          parent: { subscription_item_details: { proration: true } },
          metadata: {},
        },
      ],
    },
    subtotal: 1_795_115,
    subtotal_excluding_tax: 1_795_115,
    total_excluding_tax: 1_795_115,
    total_taxes: [],
    total: 1_795_115,
    amount_due: 1_795_115,
    period_start: 1_790_000_000,
    period_end: 1_800_000_000,
    customer_address: { country: "FR" },
  };
}

let createPreview: ReturnType<typeof stubStripe>;

function stubStripe() {
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockResolvedValue(
    fromPartial({ items: { data: [{ id: "si_1" }] } }),
  );
  return vi
    .spyOn(stripe.read.invoices, "createPreview")
    .mockResolvedValue(fromPartial(stripePreview()));
}

beforeEach(() => {
  createPreview = stubStripe();
});

describe("immediate upgrade preview", () => {
  it("asks Stripe to prorate the new price on the subscription", async () => {
    const tenantId = await seedWorkspace("plan_business");

    await previewManualUpgrade(tenantId, "plan_enterprise");

    const proratedItems: unknown = expect.objectContaining({
      items: [{ id: "si_1", price: "price_enterprise" }],
      proration_behavior: "create_prorations",
    });
    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: proratedItems,
      }),
    );
  });

  it("charges now when the interval changes, and states the MRR change", async () => {
    const tenantId = await seedWorkspace("plan_business");

    const preview = await previewManualUpgrade(tenantId, "plan_enterprise");

    expect(preview).toMatchObject({
      isChargedNow: true,
      currency: "EUR",
      amountDueMinor: 1_795_115,
      renewalAmountMinor: 82_800 * 23,
      mrrBeforeMinor: 112_700,
      mrrAfterMinor: Math.round((82_800 * 23) / 12),
      current: { name: "Business", unitAmountMinor: 4_900 },
      target: { name: "Enterprise", unitAmountMinor: 82_800 },
    });
    expect(preview.lines.map((line) => line.isProration)).toEqual([true, true]);
  });

  it("adds the prorations to the next invoice when the interval stays", async () => {
    const tenantId = await seedWorkspace("plan_team");

    const preview = await previewManualUpgrade(tenantId, "plan_business");

    expect(preview.isChargedNow).toBe(false);
    expect(preview.billingDate).toBe(PERIOD_END.toISOString());
  });

  it("refuses a target that is not an upgrade", async () => {
    const tenantId = await seedWorkspace("plan_business");

    await expect(
      previewManualUpgrade(tenantId, "plan_starter"),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.operator.upgrade_not_eligible",
    });
    expect(createPreview).not.toHaveBeenCalled();
  });
});
