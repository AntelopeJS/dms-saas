import { describe, expect, it } from "vitest";
import type { TenantSubscription } from "../src/db";
import {
  activatePaidUsage,
  canRecoverComplimentarySubscription,
  closePaidUsagePeriods,
  isComplimentaryPlanLocked,
  isComplimentarySubscription,
} from "../src/workspaces/complimentary";
import { clipInvoiceUsageWindow } from "../src/invoice-line-items/billing-window";

const CREATED = new Date("2026-01-01T00:00:00Z");
const EXPIRED = new Date("2026-02-05T12:34:00Z");
const ACTIVATED = new Date("2026-02-10T15:17:00Z");
const REGIFTED = new Date("2026-02-18T09:21:00Z");
const REACTIVATED = new Date("2026-03-03T10:11:00Z");

function gift(overrides: Partial<TenantSubscription> = {}): TenantSubscription {
  return {
    createdAt: CREATED,
    status: "active",
    stripeCustomerId: "existing-customer",
    stripeSubscriptionId: null,
    isComplimentary: true,
    freeUntil: EXPIRED,
    paidUsagePeriods: [],
    ...overrides,
  } as TenantSubscription;
}

const FEBRUARY = {
  tenantId: "tenant",
  invoiceId: "invoice",
  currency: "eur",
  periodStart: new Date("2026-02-01T00:00:00Z"),
  periodEnd: new Date("2026-03-01T00:00:00Z"),
};

describe("complimentary admission and recovery", () => {
  it("recognizes grants on an existing Stripe customer and indefinite grants", () => {
    expect(isComplimentarySubscription(gift())).toBe(true);
    expect(
      isComplimentaryPlanLocked(gift({ freeUntil: null }), REACTIVATED),
    ).toBe(true);
    expect(isComplimentarySubscription(gift({ isComplimentary: false }))).toBe(
      false,
    );
  });

  it("unlocks exactly at expiry without requiring the cron, while preserving suspension", () => {
    expect(
      isComplimentaryPlanLocked(gift(), new Date(EXPIRED.getTime() - 1)),
    ).toBe(true);
    expect(isComplimentaryPlanLocked(gift(), EXPIRED)).toBe(false);
    expect(
      canRecoverComplimentarySubscription(
        gift({ status: "suspended" }),
        EXPIRED,
      ),
    ).toBe(true);
    expect(
      canRecoverComplimentarySubscription(
        gift({ stripeSubscriptionId: "paid" }),
        EXPIRED,
      ),
    ).toBe(false);
    expect(
      canRecoverComplimentarySubscription(
        gift({ deletionStartedAt: EXPIRED }),
        EXPIRED,
      ),
    ).toBe(false);
  });
});

describe("paid usage coverage", () => {
  it("waives gift and grace usage even after checkout attaches a customer", () => {
    expect(
      clipInvoiceUsageWindow(FEBRUARY, gift({ status: "past_due" }), "paid"),
    ).toBeNull();
    expect(
      clipInvoiceUsageWindow(
        FEBRUARY,
        gift({ isComplimentary: false }),
        "paid",
      ),
    ).toBeNull();
  });

  it("clamps the first renewal to activation and keeps retries idempotent", () => {
    const activated = {
      ...gift(),
      ...activatePaidUsage(gift(), "paid", ACTIVATED),
      stripeSubscriptionId: "paid",
    };
    expect(activated.paidUsageStartedAt).toEqual(ACTIVATED);
    expect(activated.freeUntil).toBeNull();
    expect(clipInvoiceUsageWindow(FEBRUARY, activated, "paid")).toEqual({
      ...FEBRUARY,
      periodStart: ACTIVATED,
    });
    expect(
      activatePaidUsage(activated, "paid", REGIFTED).paidUsagePeriods,
    ).toEqual(activated.paidUsagePeriods);
    expect(
      clipInvoiceUsageWindow(
        { ...FEBRUARY, periodEnd: ACTIVATED },
        activated,
        "paid",
      ),
    ).toBeNull();
    expect(clipInvoiceUsageWindow(FEBRUARY, activated, "unrelated")).toBeNull();
  });

  it("preserves historical paid coverage through regrants without filling gifted gaps", () => {
    const first = {
      ...gift(),
      ...activatePaidUsage(gift(), "first", ACTIVATED),
      stripeSubscriptionId: "first",
    };
    const regift = gift({
      paidUsagePeriods: closePaidUsagePeriods(first, REGIFTED),
    });
    const second = {
      ...regift,
      ...activatePaidUsage(regift, "second", REACTIVATED),
      stripeSubscriptionId: "second",
    };
    expect(second.paidUsagePeriods).toEqual([
      { stripeSubscriptionId: "first", start: ACTIVATED, end: REGIFTED },
      { stripeSubscriptionId: "second", start: REACTIVATED, end: null },
    ]);
    expect(clipInvoiceUsageWindow(FEBRUARY, second, "first")).toEqual({
      ...FEBRUARY,
      periodStart: ACTIVATED,
      periodEnd: REGIFTED,
    });
    expect(clipInvoiceUsageWindow(FEBRUARY, second, "second")).toBeNull();
  });

  it("leaves subscriptions without a coverage ledger unclipped", () => {
    const untracked = gift({
      isComplimentary: false,
      stripeSubscriptionId: "untracked",
      paidUsagePeriods: undefined,
    });
    expect(clipInvoiceUsageWindow(FEBRUARY, untracked, "untracked")).toEqual(
      FEBRUARY,
    );
  });
});
