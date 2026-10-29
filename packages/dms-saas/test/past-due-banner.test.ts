import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  internal as layoutBanners,
  type LayoutBannerContext,
  type LayoutBannerInfo,
} from "@antelopejs/interface-dms/layout-banners";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it } from "vitest";
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
import {
  type BillingState,
  type TenantBillingState,
  TenantBillingStateModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { addTenantMember } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("past-due-banner");

const OWNER = fromPartial<User>({ _id: "owner-a" });
const MEMBER = fromPartial<User>({ _id: "member-a" });
const DAY_MS = 86_400_000;

/** The banners registered with the DMS layout, in order. */
const registered: LayoutBannerInfo[] = [];

ImplementInterface(layoutBanners, {
  RegisterLayoutBanner: {
    register: (info) => registered.push(info),
    unregister: () => undefined,
  },
});

/** The workspace of the current test: an owner and a member, no billing row. */
let tenantId = "";

function context(
  overrides: Partial<LayoutBannerContext> = {},
): LayoutBannerContext {
  return {
    user: MEMBER,
    tenantId,
    permissions: new Set(),
    isOwner: false,
    isTenantAccessDenied: false,
    ...overrides,
  };
}

const ownerContext = () => context({ user: OWNER });

/** Publishes the workspace's billing state, as the recompute does. */
async function publish(state: Partial<TenantBillingState>): Promise<void> {
  await GetModel(TenantBillingStateModel).insert({ _id: tenantId, ...state });
}

async function subscribe(
  subscription: Partial<TenantSubscription>,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    ...subscription,
  });
}

async function trialEndingIn(days: number): Promise<void> {
  await subscribe({
    status: "trialing",
    currentPeriodEnd: new Date(Date.now() + days * DAY_MS - 60_000),
  });
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

beforeEach(async () => {
  tenantId = randomUUID();
  await addTenantMember(tenantId, OWNER, true);
  await addTenantMember(tenantId, MEMBER, false);
  registered.length = 0;
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
    await publish({ billingState });
    await expect(isPastDueBannerVisible(context())).resolves.toBe(expected);
  });

  it("stays hidden for a workspace without a published billing state", async () => {
    await expect(isPastDueBannerVisible(context())).resolves.toBe(false);
  });

  it("stays hidden for a deleted workspace", async () => {
    await publish({ billingState: "past_due", deletedAt: new Date() });
    await expect(isPastDueBannerVisible(context())).resolves.toBe(false);
  });

  it("stays hidden for an unauthenticated request", async () => {
    await publish({ billingState: "past_due" });
    await expect(
      isPastDueBannerVisible(context({ user: undefined })),
    ).resolves.toBe(false);
  });

  it("shows the owner the strip with the payment action", async () => {
    await publish({ billingState: "past_due" });
    await expect(PAST_DUE_OWNER_BANNER.visible?.(ownerContext())).resolves.toBe(
      true,
    );
    await expect(
      PAST_DUE_MEMBER_BANNER.visible?.(ownerContext()),
    ).resolves.toBe(false);
  });

  it("shows a member the strip naming who pays", async () => {
    await publish({ billingState: "past_due" });
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

    expect(registered).toEqual([PAST_DUE_OWNER_BANNER, PAST_DUE_MEMBER_BANNER]);
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

  // The DMS shows banners outside the module area by default: billing state
  // must also follow the owner into the module back office.
  it("shows billing banners on every page, module area included", () => {
    const banners = [
      PAST_DUE_OWNER_BANNER,
      PAST_DUE_MEMBER_BANNER,
      ...TRIAL_ENDING_BANNERS,
    ];

    expect(banners.map((banner) => banner.scope)).toEqual(
      banners.map(() => "everywhere"),
    );
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
    await trialEndingIn(days);
    await expect(visibleTrialBanners(ownerContext())).resolves.toEqual(
      expected,
    );
  });

  it("is told to the owner only", async () => {
    await trialEndingIn(2);
    await expect(visibleTrialBanners(context())).resolves.toEqual([]);
  });

  it("stays quiet outside a trial", async () => {
    await subscribe({
      status: "active",
      currentPeriodEnd: new Date(Date.now() + DAY_MS),
    });
    await expect(visibleTrialBanners(ownerContext())).resolves.toEqual([]);
  });

  it("keeps the last reminder up until the trial ends", () => {
    registerTrialEndingBanners();

    expect(registered).toEqual(TRIAL_ENDING_BANNERS);
    expect(TRIAL_ENDING_BANNERS.map((banner) => banner.dismissible)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
