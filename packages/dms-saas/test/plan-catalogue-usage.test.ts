import { describe, expect, it } from "vitest";
import type { Plan } from "../src/db";
import { summariseCatalogue } from "../src/plans/catalogue-summary";
import {
  type PlanUsageRow,
  isBilledSubscription,
  normalisedMonthlyAmount,
  planMrrShare,
  summariseCatalogueUsage,
} from "../src/plans/catalogue-usage";

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "plan",
    name: "Plan",
    price: 0,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    isActive: true,
    isPublic: true,
    ...overrides,
  } as Plan;
}

function row(overrides: Partial<PlanUsageRow>): PlanUsageRow {
  return {
    tenantId: "tenant",
    planId: "plan",
    status: "active",
    isComplimentary: false,
    seats: 1,
    members: 1,
    ...overrides,
  };
}

describe("normalised MRR", () => {
  it("reads a yearly price per month", () => {
    expect(
      normalisedMonthlyAmount(
        plan({ price: 828, interval: "year", billingMode: "flat" }),
        5,
      ),
    ).toBe(69);
  });

  it("counts the seats of a per-seat plan", () => {
    expect(
      normalisedMonthlyAmount(plan({ price: 49, billingMode: "seat" }), 10),
    ).toBe(490);
  });

  it("ignores the seats of a flat plan", () => {
    expect(normalisedMonthlyAmount(plan({ price: 150 }), 25)).toBe(150);
  });

  it.each([
    ["active", false, true],
    ["past_due", false, true],
    ["trialing", false, false],
    ["suspended", false, false],
    ["cancelled", false, false],
    ["pending_payment", false, false],
    ["active", true, false],
  ] as const)(
    "bills a %s subscription (complimentary %s): %s",
    (status, isComplimentary, expected) => {
      expect(isBilledSubscription({ status, isComplimentary })).toBe(expected);
    },
  );
});

describe("catalogue usage", () => {
  const pro = plan({ _id: "pro", price: 29 });
  const business = plan({ _id: "business", price: 49, billingMode: "seat" });
  const free = plan({ _id: "free", price: 0 });
  const usage = summariseCatalogueUsage(
    [pro, business, free],
    [
      row({ tenantId: "a", planId: "pro" }),
      row({ tenantId: "b", planId: "pro", status: "trialing" }),
      row({ tenantId: "c", planId: "pro", isComplimentary: true }),
      row({ tenantId: "d", planId: "business", seats: 4, members: 3 }),
      row({ tenantId: "e", planId: "free" }),
      row({ tenantId: "f", planId: "deleted-plan" }),
    ],
  );

  it("counts paying, trialing and free workspaces per plan", () => {
    expect(usage.byPlan.get("pro")).toMatchObject({
      workspaces: 3,
      paying: 1,
      trialing: 1,
      free: 1,
      mrr: 29,
    });
    expect(usage.byPlan.get("free")).toMatchObject({ free: 1, mrr: 0 });
  });

  it("bills a per-seat plan for its seats", () => {
    expect(usage.byPlan.get("business")).toMatchObject({
      seats: 4,
      members: 3,
      mrr: 196,
    });
  });

  it("sums the MRR of a currency and leaves unknown plans out", () => {
    expect(usage.mrrByCurrency.get("EUR")).toBe(225);
  });

  it("gives each plan its share of its currency's MRR", () => {
    expect(planMrrShare(usage, business)).toBeCloseTo(196 / 225);
    expect(planMrrShare(usage, free)).toBe(0);
  });

  it("summarises the catalogue for the figures above it", () => {
    const legacy = plan({
      _id: "legacy",
      name: "Growth 2024",
      isActive: false,
    });
    const withLegacy = summariseCatalogueUsage(
      [pro, legacy, plan({ _id: "sales", isPublic: false })],
      [
        row({ tenantId: "a", planId: "pro" }),
        row({ tenantId: "g", planId: "legacy" }),
      ],
    );
    expect(
      summariseCatalogue(
        [pro, legacy, plan({ _id: "sales", isPublic: false })],
        withLegacy,
      ),
    ).toMatchObject({
      onSale: 2,
      publicOnSale: 1,
      salesLed: 1,
      workspaces: 2,
      legacy: 1,
      legacyWorkspaces: 1,
      legacyNames: ["Growth 2024"],
      mrr: [{ currency: "EUR", mrr: 29 }],
    });
  });
});
