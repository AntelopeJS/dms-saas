import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";

const harness = vi.hoisted(() => ({
  events: [] as string[],
  cleanup: vi.fn(),
  recompute: vi.fn(),
  seatSync: vi.fn(),
}));

vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: (...args: unknown[]) =>
    harness.recompute(...args),
}));
vi.mock("../src/plans", () => ({
  buildTenantPlanCatalog: vi.fn(),
  countOccupiedSeats: vi.fn(),
  fitsWithinSeatLimit: vi.fn(),
  isDowngrade: vi.fn(),
  syncStripeSeatQuantity: (...args: unknown[]) => harness.seatSync(...args),
}));
vi.mock("../src/workers", () => ({
  applyPlanDowngradeCleanup: (...args: unknown[]) => harness.cleanup(...args),
}));

import { finalizeImmediateChange } from "../src/routes/tenant/tenant-plan-ops";

const plan = {
  _id: "growth-plan",
  name: "Growth",
  billingMode: "seat",
} as Plan;

const subscription = {
  _id: "subscription-123",
  stripeSubscriptionId: "sub_123",
} as TenantSubscription;

beforeEach(() => {
  vi.clearAllMocks();
  harness.events.length = 0;
  harness.cleanup.mockImplementation(async () => {
    harness.events.push("permissions");
  });
  harness.seatSync.mockImplementation(async () => {
    harness.events.push("seats");
  });
  harness.recompute.mockImplementation(async () => {
    harness.events.push("billing");
  });
});

describe("immediate plan change finalization", () => {
  it("retries permission cleanup before seat and billing synchronization", async () => {
    await finalizeImmediateChange("tenant-123", subscription, plan);

    expect(harness.cleanup).toHaveBeenCalledWith("tenant-123", plan);
    expect(harness.seatSync).toHaveBeenCalledWith({
      tenantId: "tenant-123",
      plan,
      stripeSubscriptionId: "sub_123",
      idempotencyKey:
        "seat-sync:change-plan:tenant-123:subscription-123:growth-plan",
    });
    expect(harness.events).toEqual(["permissions", "seats", "billing"]);
  });
});
