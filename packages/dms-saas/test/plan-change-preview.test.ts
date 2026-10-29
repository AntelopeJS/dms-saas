import { randomUUID } from "node:crypto";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";
import {
  previewPlanChange,
  recurringAmountMinorUnits,
  resolvePlanChangeKind,
} from "../src/routes/tenant/tenant-plan-preview";
import { acceptedProrationDate } from "../src/routes/tenant/tenant-plan";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { seatMembers } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("plan-change-preview");
const stripe = useSuiteStripe();
const logs = captureLogs();

const NOW = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-31T00:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

function plan(overrides: Partial<Plan>): Plan {
  return fromPartial<Plan>({
    _id: "plan",
    name: "Plan",
    price: 49,
    currency: "eur",
    interval: "month",
    billingMode: "seat",
    trialDays: 0,
    maxMembers: 10,
    paymentProviderRefs: { stripePriceId: "price_plan" },
    ...overrides,
  });
}

const BUSINESS = plan({ _id: "business", price: 49 });
const ENTERPRISE = plan({
  _id: "enterprise",
  price: 69,
  paymentProviderRefs: { stripePriceId: "price_enterprise" },
});
const PRO = plan({
  _id: "pro",
  price: 29,
  billingMode: "flat",
  paymentProviderRefs: { stripePriceId: "price_pro" },
});
const FREE = plan({
  _id: "free",
  price: 0,
  billingMode: "flat",
  paymentProviderRefs: {},
});

const PAID_SUBSCRIPTION = fromPartial<TenantSubscription>({
  _id: "tenant-a",
  planId: "business",
  status: "active",
  stripeCustomerId: "cus_a",
  stripeSubscriptionId: "sub_a",
  currentPeriodEnd: PERIOD_END,
});

const FREE_SUBSCRIPTION = fromPartial<TenantSubscription>({
  _id: "tenant-a",
  planId: "free",
  status: "active",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});

function previewInvoice(totalMinorUnits: number): Stripe.Invoice {
  return fromPartial<Stripe.Invoice>({
    currency: "eur",
    lines: {
      data: [
        {
          description: "Remaining time on Enterprise",
          amount: 59700,
          taxes: [],
          quantity: 10,
          period: { start: seconds(NOW), end: seconds(PERIOD_END) },
          parent: {
            subscription_item_details: {
              invoice_item: "ii_1",
              proration: true,
            },
          },
          metadata: {},
        },
      ],
      has_more: false,
    },
    subtotal: 17700,
    subtotal_excluding_tax: 17700,
    total_excluding_tax: 17700,
    total: totalMinorUnits,
    amount_due: totalMinorUnits,
    total_taxes: [],
    customer_address: { country: "FR" },
    automatic_tax: { enabled: true, status: "complete" },
    period_start: seconds(NOW),
    period_end: seconds(NOW),
  });
}

function stripeSubscription(status = "active"): Stripe.Subscription {
  return fromPartial<Stripe.Subscription>({
    id: "sub_a",
    customer: "cus_a",
    status,
    trial_end: status === "trialing" ? seconds(PERIOD_END) : null,
    items: {
      data: [
        {
          id: "si_a",
          current_period_start: seconds(NOW),
          current_period_end: seconds(PERIOD_END),
        },
      ],
    },
  });
}

let tenantId: string;

const input = (overrides: object) => ({
  tenantId,
  subscription: PAID_SUBSCRIPTION,
  currentPlan: BUSINESS,
  target: ENTERPRISE,
  billingInfo: undefined,
  ownerEmail: "owner@example.test",
  country: null,
  ...overrides,
});

function stubStripe() {
  return {
    retrieveSubscription: vi
      .spyOn(stripe.write.subscriptions, "retrieve")
      .mockResolvedValue(fromPartial(stripeSubscription())),
    createPreview: vi
      .spyOn(stripe.read.invoices, "createPreview")
      .mockResolvedValue(fromPartial(previewInvoice(21240))),
  };
}

let api: ReturnType<typeof stubStripe>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  tenantId = randomUUID();
  await seatMembers(tenantId, 10);
  api = stubStripe();
});

describe("plan change kind", () => {
  it("routes a paid target without a Stripe subscription to checkout", () => {
    expect(resolvePlanChangeKind(FREE_SUBSCRIPTION, FREE, PRO)).toBe(
      "checkout",
    );
  });

  it("parks a cheaper or free plan until the renewal", () => {
    expect(resolvePlanChangeKind(PAID_SUBSCRIPTION, BUSINESS, PRO)).toBe(
      "downgrade",
    );
    expect(resolvePlanChangeKind(PAID_SUBSCRIPTION, BUSINESS, FREE)).toBe(
      "downgrade",
    );
  });

  it("applies a dearer plan at once", () => {
    expect(resolvePlanChangeKind(PAID_SUBSCRIPTION, BUSINESS, ENTERPRISE)).toBe(
      "upgrade",
    );
  });
});

describe("plan change preview", () => {
  it("bills a seat plan per occupied seat", () => {
    expect(recurringAmountMinorUnits(ENTERPRISE, 10)).toBe(69000);
  });

  it("prices an upgrade with Stripe's immediate proration", async () => {
    const preview = await previewPlanChange(input({}));

    expect(api.createPreview).toHaveBeenCalledWith({
      customer: "cus_a",
      subscription: "sub_a",
      subscription_details: {
        items: [{ id: "si_a", price: "price_enterprise", quantity: 10 }],
        proration_behavior: "always_invoice",
        proration_date: seconds(NOW),
      },
    });
    expect(preview).toMatchObject({
      kind: "upgrade",
      quantity: 10,
      effectiveAt: null,
      isTrial: false,
      isChargeAvailable: true,
      prorationDate: seconds(NOW),
      renewal: { at: PERIOD_END, amountExcludingTaxMinorUnits: 69000 },
    });
    expect(preview.charge?.amountDueMinorUnits).toBe(21240);
  });

  it("restarts the cycle today when the interval changes", async () => {
    const yearly = plan({ ...ENTERPRISE, interval: "year", price: 690 });
    const preview = await previewPlanChange(input({ target: yearly }));

    expect(preview.renewal.at).toEqual(new Date("2027-10-01T00:00:00.000Z"));
  });

  it("says when the trial ends for an upgrade during a trial", async () => {
    api.retrieveSubscription.mockResolvedValue(
      fromPartial(stripeSubscription("trialing")),
    );
    api.createPreview.mockResolvedValue(fromPartial(previewInvoice(0)));

    const preview = await previewPlanChange(input({}));

    expect(preview).toMatchObject({ isTrial: true, trialEndsAt: PERIOD_END });
    expect(preview.charge?.amountDueMinorUnits).toBe(0);
  });

  it("reports an unpriced upgrade instead of inventing an amount", async () => {
    api.createPreview.mockRejectedValue(new Error("Stripe is down"));

    const preview = await previewPlanChange(input({}));

    expect(preview).toMatchObject({ charge: null, isChargeAvailable: false });
    expect(logs.at("WARN")).toContainEqual([
      "[dms-saas:plan-preview] Stripe could not price the change",
      new Error("Stripe is down"),
    ]);
  });

  it("charges nothing today for a downgrade and names the renewal", async () => {
    tenantId = randomUUID();
    await seatMembers(tenantId, 4);
    const preview = await previewPlanChange(input({ target: PRO }));

    expect(api.createPreview).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      kind: "downgrade",
      quantity: 1,
      effectiveAt: PERIOD_END,
      charge: null,
      renewal: { at: PERIOD_END, amountExcludingTaxMinorUnits: 2900 },
    });
  });

  it("prices a first subscription with the tax of the typed country", async () => {
    const trialPro = plan({ ...PRO, trialDays: 14 });

    const preview = await previewPlanChange(
      input({
        subscription: FREE_SUBSCRIPTION,
        currentPlan: FREE,
        target: trialPro,
        country: "fr",
      }),
    );

    expect(api.createPreview).toHaveBeenCalledWith({
      customer: undefined,
      customer_details: {
        address: {
          country: "FR",
          postal_code: undefined,
          city: undefined,
          line1: undefined,
        },
      },
      automatic_tax: { enabled: true },
      subscription_details: { items: [{ price: "price_pro", quantity: 1 }] },
    });
    expect(preview).toMatchObject({
      kind: "checkout",
      isTrial: true,
      trialEndsAt: new Date("2026-10-15T00:00:00.000Z"),
      renewal: { at: new Date("2026-11-15T00:00:00.000Z") },
    });
  });

  it("does not price a first subscription without a billing country", async () => {
    const preview = await previewPlanChange(
      input({
        subscription: FREE_SUBSCRIPTION,
        currentPlan: FREE,
        target: PRO,
      }),
    );

    expect(api.createPreview).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      kind: "checkout",
      isChargeAvailable: false,
    });
  });
});

describe("reviewed proration date", () => {
  it("keeps a recent date and drops a stale or malformed one", () => {
    expect(acceptedProrationDate(seconds(NOW) - 60)).toBe(seconds(NOW) - 60);
    expect(acceptedProrationDate(seconds(NOW) - 7200)).toBeUndefined();
    expect(acceptedProrationDate(seconds(NOW) + 60)).toBeUndefined();
    expect(acceptedProrationDate("1700000000")).toBeUndefined();
  });
});
