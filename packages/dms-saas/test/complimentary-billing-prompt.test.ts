import { describe, expect, it } from "vitest";
import type { TenantSubscription } from "../src/db";
import { isComplimentaryPlanLocked } from "../src/workspaces/complimentary";
import { resolveComplimentaryAccess } from "../frontend-vue/app/composables/useComplimentaryAccess";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ENDS_AT = new Date("2026-12-31T00:00:00.000Z");
const ENDED_AT = new Date("2026-09-30T00:00:00.000Z");

function subscription(
  overrides: Partial<TenantSubscription> = {},
): TenantSubscription {
  return {
    _id: "sub-1",
    tenantId: "tenant-1",
    planId: "pro",
    status: "active",
    isComplimentary: true,
    freeUntil: null,
    ...overrides,
  } as TenantSubscription;
}

/** Mirrors the plan payload the billing page reads, as the server builds it. */
function planPayloadFor(sub: TenantSubscription) {
  return {
    isPlanChangeLocked: isComplimentaryPlanLocked(sub, NOW),
    freeUntil: sub.freeUntil?.toISOString() ?? null,
  };
}

describe("payment method prompt on complimentary workspaces", () => {
  it("replaces the upgrade prompt while an open-ended gift is in force", () => {
    expect(resolveComplimentaryAccess(planPayloadFor(subscription()))).toEqual({
      endsAt: null,
    });
  });

  it("carries the end date of a gift that is still running", () => {
    expect(
      resolveComplimentaryAccess(
        planPayloadFor(subscription({ freeUntil: ENDS_AT })),
      ),
    ).toEqual({ endsAt: ENDS_AT.toISOString() });
  });

  it("brings the upgrade prompt back once the gift has ended", () => {
    expect(
      resolveComplimentaryAccess(
        planPayloadFor(subscription({ freeUntil: ENDED_AT })),
      ),
    ).toBeNull();
  });

  it("leaves paid workspaces and unloaded plans unchanged", () => {
    expect(
      resolveComplimentaryAccess(
        planPayloadFor(subscription({ isComplimentary: false })),
      ),
    ).toBeNull();
    expect(resolveComplimentaryAccess(null)).toBeNull();
  });
});
