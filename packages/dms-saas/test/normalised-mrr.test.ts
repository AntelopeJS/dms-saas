import { describe, expect, it } from "vitest";
import {
  monthlyPlanAmountMinor,
  type MrrInput,
  type MrrPlanTerms,
  normalisedMrr,
  sumInReportingCurrency,
} from "../src/metrics/normalised-mrr";

const MONTHLY_FLAT: MrrPlanTerms = {
  price: 29,
  currency: "eur",
  interval: "month",
  billingMode: "flat",
};
const MONTHLY_SEAT: MrrPlanTerms = {
  ...MONTHLY_FLAT,
  price: 49,
  billingMode: "seat",
};
const YEARLY_SEAT: MrrPlanTerms = {
  ...MONTHLY_FLAT,
  price: 828,
  interval: "year",
  billingMode: "seat",
};

function mrrOf(overrides: Partial<MrrInput>): number {
  return normalisedMrr({
    billingState: "active",
    isComplimentary: false,
    plan: MONTHLY_FLAT,
    billedSeats: 1,
    ...overrides,
  }).amountMinor;
}

describe("normalised MRR of a workspace", () => {
  it("counts a monthly flat plan at its price", () => {
    expect(mrrOf({})).toBe(2_900);
  });

  it("multiplies a seat price by the billed seats", () => {
    expect(mrrOf({ plan: MONTHLY_SEAT, billedSeats: 23 })).toBe(112_700);
  });

  it("divides a yearly price by twelve", () => {
    expect(mrrOf({ plan: YEARLY_SEAT, billedSeats: 12 })).toBe(82_800);
  });

  it("bills a seat plan for at least one seat", () => {
    expect(mrrOf({ plan: MONTHLY_SEAT, billedSeats: 0 })).toBe(4_900);
  });

  it("keeps a past-due workspace in MRR, as the money is at risk, not lost", () => {
    expect(mrrOf({ billingState: "past_due" })).toBe(2_900);
  });

  it.each([
    "trialing",
    "free",
    "suspended",
    "pending_payment",
    "cancelled",
  ] as const)("counts nothing for a %s workspace", (billingState) => {
    expect(mrrOf({ billingState })).toBe(0);
  });

  it("counts nothing for complimentary access or a free plan", () => {
    expect(mrrOf({ isComplimentary: true })).toBe(0);
    expect(mrrOf({ plan: { ...MONTHLY_FLAT, price: 0 } })).toBe(0);
    expect(mrrOf({ plan: null })).toBe(0);
  });

  it("names the currency in upper case", () => {
    expect(
      normalisedMrr({
        billingState: "active",
        isComplimentary: false,
        plan: MONTHLY_FLAT,
        billedSeats: 1,
      }).currency,
    ).toBe("EUR");
  });

  it("states what a plan would bill whatever the workspace's state", () => {
    expect(monthlyPlanAmountMinor(YEARLY_SEAT, 2)).toBe(13_800);
  });
});

describe("MRR in the reporting currency", () => {
  it("sums the reporting currency and sets the others apart", () => {
    const total = sumInReportingCurrency(
      [
        { amountMinor: 1_000, currency: "EUR" },
        { amountMinor: 500, currency: "eur" },
        { amountMinor: 700, currency: "USD" },
        { amountMinor: 300, currency: "GBP" },
        { amountMinor: 200, currency: "USD" },
        { amountMinor: 0, currency: "CHF" },
      ],
      "eur",
    );

    expect(total).toEqual({
      amountMinor: 1_500,
      currency: "EUR",
      otherCurrencies: [
        { currency: "GBP", amountMinor: 300 },
        { currency: "USD", amountMinor: 900 },
      ],
    });
  });

  it("answers zero when nothing is billed", () => {
    expect(sumInReportingCurrency([], "EUR")).toEqual({
      amountMinor: 0,
      currency: "EUR",
      otherCurrencies: [],
    });
  });
});
