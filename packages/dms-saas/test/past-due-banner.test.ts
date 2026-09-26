import type { User } from "@antelopejs/interface-dms/auth/db";
import type { LayoutBannerContext } from "@antelopejs/interface-dms/layout-banners";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPastDueBannerVisible,
  PAST_DUE_BANNER,
  registerPastDueBanner,
} from "../src/billing-state/past-due-banner";
import type { BillingState, TenantBillingState } from "../src/db";

const TENANT_ID = "tenant-a";

const harness = vi.hoisted(() => ({
  states: new Map<string, Partial<TenantBillingState>>(),
  registered: [] as unknown[],
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: () => ({
      findByTenant: async (tenantId: string) => harness.states.get(tenantId),
    }),
  };
});

vi.mock("@antelopejs/interface-dms/layout-banners", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@antelopejs/interface-dms/layout-banners")
  >()),
  RegisterLayoutBanner: (info: unknown) => {
    harness.registered.push(info);
    return () => undefined;
  },
}));

function context(
  overrides: Partial<LayoutBannerContext> = {},
): LayoutBannerContext {
  return {
    user: { _id: "user-a" } as User,
    tenantId: TENANT_ID,
    permissions: new Set(),
    isOwner: false,
    isTenantAccessDenied: false,
    ...overrides,
  };
}

function publish(state: Partial<TenantBillingState>): void {
  harness.states.set(TENANT_ID, state);
}

beforeEach(() => {
  harness.states.clear();
  harness.registered.length = 0;
});

describe("past-due layout banner visibility", () => {
  it.each<[BillingState, boolean]>([
    ["free", false],
    ["active", false],
    ["trialing", false],
    ["pending_payment", false],
    ["suspended", false],
    ["cancelled", false],
    ["past_due", true],
  ])("shows for billing state %s: %s", async (billingState, expected) => {
    publish({ billingState });
    await expect(isPastDueBannerVisible(context())).resolves.toBe(expected);
  });

  it("stays hidden for a workspace without a published billing state", async () => {
    await expect(isPastDueBannerVisible(context())).resolves.toBe(false);
  });

  it("stays hidden for a deleted workspace", async () => {
    publish({ billingState: "past_due", deletedAt: new Date() });
    await expect(isPastDueBannerVisible(context())).resolves.toBe(false);
  });

  it("stays hidden for an unauthenticated request", async () => {
    publish({ billingState: "past_due" });
    await expect(
      isPastDueBannerVisible(context({ user: undefined })),
    ).resolves.toBe(false);
  });

  it("shows to members as well as owners", async () => {
    publish({ billingState: "past_due" });
    await expect(
      isPastDueBannerVisible(context({ isOwner: true })),
    ).resolves.toBe(true);
    await expect(
      isPastDueBannerVisible(context({ isOwner: false })),
    ).resolves.toBe(true);
  });
});

describe("past-due layout banner registration", () => {
  it("registers an error banner rendering the past-due component", () => {
    registerPastDueBanner();

    expect(harness.registered).toEqual([PAST_DUE_BANNER]);
    expect(PAST_DUE_BANNER).toMatchObject({
      variant: "error",
      component: "DmsSaasPastDueBanner",
      visible: isPastDueBannerVisible,
    });
  });
});
