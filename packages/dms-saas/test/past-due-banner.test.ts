import type { User } from "@antelopejs/interface-dms/auth/db";
import type { LayoutBannerContext } from "@antelopejs/interface-dms/layout-banners";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPastDueBannerVisible,
  PAST_DUE_MEMBER_BANNER,
  PAST_DUE_OWNER_BANNER,
  registerPastDueBanners,
} from "../src/billing-state/past-due-banner";
import {
  registerTrialEndingBanners,
  TRIAL_ENDING_BANNERS,
  trialDaysLeft,
} from "../src/billing-state/trial-ending-banner";
import type {
  BillingState,
  TenantBillingState,
  TenantSubscription,
} from "../src/db";

const TENANT_ID = "tenant-a";
const OWNER_ID = "owner-a";
const MEMBER_ID = "member-a";
const DAY_MS = 86_400_000;

const harness = vi.hoisted(() => ({
  states: new Map<string, Partial<TenantBillingState>>(),
  subscription: undefined as Partial<TenantSubscription> | undefined,
  owners: new Set<string>(),
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
      findOne: async () => harness.subscription,
      getByUser: async (userId: string) => ({
        userId,
        isTenantOwner: harness.owners.has(userId),
      }),
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
    user: { _id: MEMBER_ID } as User,
    tenantId: TENANT_ID,
    permissions: new Set(),
    isOwner: false,
    isTenantAccessDenied: false,
    ...overrides,
  };
}

const ownerContext = () => context({ user: { _id: OWNER_ID } as User });

function publish(state: Partial<TenantBillingState>): void {
  harness.states.set(TENANT_ID, state);
}

function trialEndingIn(days: number): void {
  harness.subscription = {
    status: "trialing",
    currentPeriodEnd: new Date(Date.now() + days * DAY_MS - 60_000),
  };
}

async function visibleTrialBanners(
  bannerContext: LayoutBannerContext,
): Promise<string[]> {
  const visible = await Promise.all(
    TRIAL_ENDING_BANNERS.map(async (banner) =>
      (await banner.visible?.(bannerContext)) ? banner.key : null,
    ),
  );
  return visible.filter((key): key is string => key !== null);
}

beforeEach(() => {
  harness.states.clear();
  harness.owners = new Set([OWNER_ID]);
  harness.subscription = undefined;
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

  it("shows the owner the strip with the payment action", async () => {
    publish({ billingState: "past_due" });
    await expect(PAST_DUE_OWNER_BANNER.visible?.(ownerContext())).resolves.toBe(
      true,
    );
    await expect(
      PAST_DUE_MEMBER_BANNER.visible?.(ownerContext()),
    ).resolves.toBe(false);
  });

  it("shows a member the strip naming who pays", async () => {
    publish({ billingState: "past_due" });
    await expect(PAST_DUE_MEMBER_BANNER.visible?.(context())).resolves.toBe(
      true,
    );
    await expect(PAST_DUE_OWNER_BANNER.visible?.(context())).resolves.toBe(
      false,
    );
  });
});

describe("past-due layout banner registration", () => {
  it("registers the owner error strip and the dismissible member warning", () => {
    registerPastDueBanners();

    expect(harness.registered).toEqual([
      PAST_DUE_OWNER_BANNER,
      PAST_DUE_MEMBER_BANNER,
    ]);
    expect(PAST_DUE_OWNER_BANNER).toMatchObject({
      variant: "error",
      component: "DmsSaasPastDueBanner",
      props: { audience: "owner" },
    });
    expect(PAST_DUE_OWNER_BANNER.dismissible).toBeUndefined();
    expect(PAST_DUE_MEMBER_BANNER).toMatchObject({
      variant: "warning",
      dismissible: true,
      props: { audience: "member" },
    });
  });
});

describe("trial ending reminders", () => {
  it("counts a started day as a day left", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(trialDaysLeft(new Date("2026-10-08T00:00:00Z"), now)).toBe(1);
    expect(trialDaysLeft(new Date("2026-10-14T12:00:00Z"), now)).toBe(7);
  });

  it.each<[number, string[]]>([
    [14, []],
    [7, ["dms-saas:trial-ending-7"]],
    [4, ["dms-saas:trial-ending-7"]],
    [3, ["dms-saas:trial-ending-3"]],
    [2, ["dms-saas:trial-ending-3"]],
    [1, ["dms-saas:trial-ending-1"]],
  ])("with %i days left, shows %j", async (days, expected) => {
    trialEndingIn(days);
    await expect(visibleTrialBanners(ownerContext())).resolves.toEqual(
      expected,
    );
  });

  it("is told to the owner only", async () => {
    trialEndingIn(2);
    await expect(visibleTrialBanners(context())).resolves.toEqual([]);
  });

  it("stays quiet outside a trial", async () => {
    harness.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + DAY_MS),
    };
    await expect(visibleTrialBanners(ownerContext())).resolves.toEqual([]);
  });

  it("keeps the last reminder up until the trial ends", () => {
    registerTrialEndingBanners();

    expect(harness.registered).toEqual(TRIAL_ENDING_BANNERS);
    expect(TRIAL_ENDING_BANNERS.map((banner) => banner.dismissible)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
